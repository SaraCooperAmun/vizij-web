import { Suspense, memo, useContext, useEffect } from "react";
import type { ReactNode, ComponentProps, CSSProperties } from "react";
import { ErrorBoundary } from "react-error-boundary";
import type { OrthographicCamera as OrthographicCameraType } from "three";
import { Object3D, SRGBColorSpace, NoToneMapping } from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { Line, OrthographicCamera, Text } from "@react-three/drei";
import { useShallow } from "zustand/react/shallow";
import { Renderable } from "./renderables";
import { VizijContext } from "./context";
import { useDefaultVizijStore } from "./store";
import { useVizijStore } from "./hooks/use-vizij-store";
import { recordRenderCounter } from "./memoryInvestigation";
import type { VizijActions, VizijData } from "./store-types";
import type { Group } from "./types";
import { SelectionGlowEffect } from "./effects/selection-glow-effect";

/*
 * Uniformly scale the entire rendered model.
 *
 * IMPORTANT:
 * Do NOT apply this value to rootBounds/camera fitting.
 * Otherwise the orthographic camera compensates for the scale
 * and the model appears the same size on screen.
 */

type RootBounds = NonNullable<Group["rootBounds"]>;

Object3D.DEFAULT_UP.set(0, 0, 1);

export interface VizijProps {
  style?: CSSProperties;
  className?: string;
  rootId: string;
  namespace?: string;
  showSafeArea?: boolean;
  showSelectionGlow?: boolean;
  modelScale?: number;
  onPointerMissed?: ComponentProps<typeof Canvas>["onPointerMissed"];
}

/**
 * Renders the Vizij component.
 *
 * @param style - The style object for the Vizij component.
 *
 * @param className - The class name for the Vizij component
 *
 * @param rootId - The root identifier for the Vizij component.
 *
 * @param namespace - The namespace for the Vizij component
 *
 * @param showSafeArea - Whether to show the safe area.
 *
 * @returns The rendered ReactNode.
 */
export function Vizij({
  style,
  className,
  rootId,
  namespace = "default",
  showSafeArea = false,
  showSelectionGlow = false,
  onPointerMissed,
  modelScale = 1,
}: VizijProps): ReactNode {
  const ctx = useContext(VizijContext);

  useEffect(() => {
    recordRenderCounter("canvasMountCount");
    recordRenderCounter("mountedCanvasCount");

    return () => {
      recordRenderCounter("mountedCanvasCount", -1);
    };
  }, []);


if (ctx) {
  return (
    <Canvas
      shadows={false}
      style={style}
      className={className}
      onPointerMissed={onPointerMissed}
      gl={{
        alpha: true,
        outputColorSpace: SRGBColorSpace,
        toneMapping: NoToneMapping,
        antialias: true,
      }}
    >
      <MemoizedInnerVizij
        rootId={rootId}
        namespace={namespace}
        showSafeArea={showSafeArea}
        showSelectionGlow={showSelectionGlow}
        modelScale={modelScale}
      />
    </Canvas>
  );

  } else {
    return (
      <VizijContext.Provider value={useDefaultVizijStore}>
        <Canvas
          style={style}
          className={className}
          onPointerMissed={onPointerMissed}
          gl={{
            outputColorSpace: SRGBColorSpace,
            toneMapping: NoToneMapping,
            antialias: true,
          }}
        >
          <MemoizedInnerVizij
            rootId={rootId}
            namespace={namespace}
            showSafeArea={showSafeArea}
            showSelectionGlow={showSelectionGlow}
            modelScale={modelScale}
          />
        </Canvas>
      </VizijContext.Provider>
    );
  }
}

export interface InnerVizijProps {
  rootId: string;
  namespace: string;
  container?: {
    width: number;
    height: number;
    resolution: number;
  };
  showSafeArea?: boolean;
  showSelectionGlow?: boolean;
  modelScale?: number;
}

export function InnerVizij({
  rootId,
  namespace = "default",
  container,
  showSafeArea,
  showSelectionGlow,
  modelScale = 1,
}: InnerVizijProps) {
  const sceneParentSizing: { width: number; height: number } | undefined =
    container
      ? {
          width: container.width * container.resolution,
          height: container.height * container.resolution,
        }
      : undefined;

  return (
    <>
      <ambientLight intensity={Math.PI / 2} />

      <OrthographicCamera
        makeDefault
        position={[0, 0, 100]}
        near={0.1}
        far={1000}
      />

      <Suspense fallback={null}>
        <World
          rootId={rootId}
          namespace={namespace}
          parentSizing={sceneParentSizing}
          modelScale={modelScale}
        />
      </Suspense>

      {showSelectionGlow && <SelectionGlowEffect enabled />}

      {showSafeArea && <SafeAreaRenderer rootId={rootId} />}
    </>
  );
}

const MemoizedInnerVizij = memo(InnerVizij);

/**
 * Renders the inner world of the scene.
 *
 * The entire Vizij model is wrapped in a uniformly scaled
 * Three.js group. Camera fitting deliberately uses the
 * ORIGINAL root bounds so that the camera does not cancel
 * the visual enlargement.
 */
function InnerWorld({
  rootId,
  namespace = "default",
  parentSizing,
  modelScale = 1,
}: {
  rootId: string;
  namespace?: string;
  parentSizing?: { width: number; height: number };
  modelScale?: number;
}) {
  const [present, rootBounds] = useVizijStore(
    useShallow((state: VizijData & VizijActions) => {
      const group = state.world[rootId] as Group | undefined;
      const bounds: RootBounds = group?.rootBounds ?? defaultRootBounds;

      return [group !== undefined, bounds] as [boolean, RootBounds];
    }),
  );

  const { camera, size } = useThree((state) => ({
    camera: state.camera,
    size: state.size,
  }));

  useEffect(() => {
    /*
     * IMPORTANT:
     *
     * rootBounds are intentionally NOT multiplied by MODEL_SCALE here.
     *
     * The model itself is scaled below, while the camera continues
     * to use the original bounds. This makes the model appear larger
     * on screen instead of the camera compensating for the scale.
     */
    const width = rootBounds.size.x;
    const height = rootBounds.size.y;

    if (
      camera &&
      parentSizing === undefined &&
      (camera as OrthographicCameraType).isOrthographicCamera
    ) {
      const zoom = Math.min(size.width / width, size.height / height);
      const center = rootBounds.center;

      if (camera.zoom !== zoom * modelScale) {
        camera.zoom = zoom * modelScale;
        camera.updateProjectionMatrix();
      }

      if (
        camera.position.x !== center.x ||
        camera.position.y !== center.y
      ) {
        camera.position.x = center.x;
        camera.position.y = center.y;
        camera.updateProjectionMatrix();
      }
    } else if (
      camera &&
      parentSizing !== undefined &&
      (camera as OrthographicCameraType).isOrthographicCamera
    ) {
      const zoom = Math.min(
        parentSizing.width / width,
        parentSizing.height / height,
      );

      const center = rootBounds.center;

      (camera as OrthographicCameraType).left =
        (-0.5 * parentSizing.width) / zoom + center.x;

      (camera as OrthographicCameraType).right =
        (0.5 * parentSizing.width) / zoom + center.x;

      (camera as OrthographicCameraType).top =
        (0.5 * parentSizing.height) / zoom + center.y;

      (camera as OrthographicCameraType).bottom =
        (-0.5 * parentSizing.height) / zoom + center.y;

      (camera as OrthographicCameraType).updateProjectionMatrix();
    }
  }, [rootBounds, camera, parentSizing, size, modelScale]);

return (
  <ErrorBoundary fallback={null}>
    {present && (
      <group
        scale={modelScale}
        ref={(node) => {
        }}
      >
        <Renderable id={rootId} namespace={namespace} chain={[]} />
      </group>
    )}
      {!present && (
        <Text
          position={[0, 0, 0]}
          color="white"
          anchorX="center"
          anchorY="middle"
          fontSize={0.7}
        >
          No Output
        </Text>
      )}
    </ErrorBoundary>
  );
}

const World = memo(InnerWorld);

function SafeAreaRenderer({ rootId }: { rootId: string }) {
  const rootBounds = useVizijStore((state: VizijData & VizijActions) => {
    const group = state.world[rootId] as Group | undefined;

    return (group?.rootBounds ?? defaultRootBounds) as RootBounds;
  });

  const left = rootBounds.center.x - rootBounds.size.x / 2;
  const right = rootBounds.center.x + rootBounds.size.x / 2;
  const top = rootBounds.center.y + rootBounds.size.y / 2;
  const bottom = rootBounds.center.y - rootBounds.size.y / 2;

  return (
    <Line
      points={[
        [left, top, 99],
        [right, top, 99],
        [right, bottom, 99],
        [left, bottom, 99],
        [left, top, 99],
      ]}
      color="red"
      lineWidth={2}
    />
  );
}

const defaultRootBounds: RootBounds = {
  center: { x: 0, y: 0 },
  size: { x: 5, y: 4 },
};
