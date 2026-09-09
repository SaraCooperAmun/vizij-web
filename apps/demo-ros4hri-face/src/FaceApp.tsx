import { useEffect, useMemo, useRef, useState } from "react";
import {
  VizijRuntimeProvider,
  VizijRuntimeFace,
  useVizijRuntime,
  resolveFaceControls,
  type VizijAssetBundle,
} from "@vizij/runtime-react";
import { useIdleGazeBehavior } from "./hooks/useIdleGazeBehavior";

import { usePoseHotkeys } from "./hooks/usePoseHotkeys";
import { useVisemeMouth } from "./hooks/useVisemeMouth";
import { AudioManager } from "./utils/audioManager";
import { useWebSocketFaceControl } from "./hooks/useWebSocketFaceControl";

import "./styles.css";

/*
 * --------------------------------------------------------------------------
 * Vizij face asset
 * --------------------------------------------------------------------------
 */

const faceAssetUrl = new URL(
  "../../demo-ros4hri/public/assets/emy.glb",
  import.meta.url,
).href;


const assetBundle: VizijAssetBundle = {
  namespace: "demo-ros4hri-face",

  glb: {
    kind: "url",
    src: faceAssetUrl,
    aggressiveImport: true,
  },

  pose: {
    stageNeutralFilter: (_id, path) => !path.includes("/color/"),
  },
};


/*
 * --------------------------------------------------------------------------
 * Speech state
 * --------------------------------------------------------------------------
 *
 * Coqui/ROS2 generates and plays the actual audio.
 *
 * The browser receives:
 *
 *   {
 *     type: "say",
 *     text: "...",
 *     duration: 2.688
 *   }
 *
 * and uses the duration/start time to drive the visemes.
 */

type SpeechState = {
  text: string;
  duration: number;
  startedAt: number;
  sequence: number;
};

function AgentFaceRuntime() {
  const runtime = useVizijRuntime();

  const {
    ready,
    loading,
    error,
    stagePoseNeutral,
    setInput,
    inputConstraints,
    faceId,
    animateValue,
    assetBundle: runtimeAssetBundle,
  } = runtime;

  /*
   * ------------------------------------------------------------------------
   * Runtime / face controls
   * ------------------------------------------------------------------------
   *
   * controls:
   *   Used by the WebSocket controller for gaze.
   *
   * bindings:
   *   Used by the WebSocket controller to resolve
   *   semantic pose names to actual face pose paths.
   */

  const poseConfig =
    runtimeAssetBundle.pose?.config ?? null;

  const controls = useMemo(
    () =>
      resolveFaceControls(
        runtimeAssetBundle,
        faceId,
        inputConstraints,
      ),
    [
      runtimeAssetBundle,
      faceId,
      inputConstraints,
    ],
  );

  /*
   * ------------------------------------------------------------------------
   * Pose bindings
   * ------------------------------------------------------------------------
   *
   * We still need usePoseHotkeys because it owns the
   * semantic pose bindings used by useWebSocketFaceControl.
   *
   * Keyboard hotkeys themselves are disabled.
   */

  const { bindings } =
    usePoseHotkeys(
      poseConfig,
      ready,
      {
        enableHotkeys: false,
      },
    );

    
  const [gazePolicy, setGazePolicy] =
    useState<string | null>(null);

  const idleGazeEnabled =
    ready && gazePolicy === "idle";

  console.log(
    "[FaceApp] idle gaze enabled:",
    idleGazeEnabled,
    "policy:",
    gazePolicy,
  );

    useIdleGazeBehavior({
      enabled:
         idleGazeEnabled,
      pointerActive:
        false,
    });
  /*
   * ------------------------------------------------------------------------
   * Neutral pose
   * ------------------------------------------------------------------------
   */

  useEffect(() => {
    if (ready) {
      stagePoseNeutral();
    }
  }, [
    ready,
    stagePoseNeutral,
  ]);

  /*
   * ------------------------------------------------------------------------
   * Speech state
   * ------------------------------------------------------------------------
   */

  const [speech, setSpeech] =
    useState<SpeechState>({
      text: "",
      duration: 0,
      startedAt: 0,
      sequence: 0,
    });

  /*
   * ------------------------------------------------------------------------
   * Audio manager
   * ------------------------------------------------------------------------
   *
   * Coqui owns the actual audio playback.
   *
   * AudioManager is still supplied to useVisemeMouth
   * because that hook expects an AudioManager instance.
   */

  const audioManager = useMemo(
    () => new AudioManager(),
    [],
  );

  /*
   * ------------------------------------------------------------------------
   * Speaking state
   * ------------------------------------------------------------------------
   *
   * This is only used for the browser's speaking state.
   * It does NOT control the actual Coqui audio.
   */

  const [isSpeaking, setIsSpeaking] =
    useState(false);

  const [visemesEnabled, setVisemesEnabled] =
    useState(true);

  const speakingTimeoutRef =
    useRef<number | null>(null);

  const clearSpeakingTimeout =
    () => {
      if (
        speakingTimeoutRef.current !==
        null
      ) {
        window.clearTimeout(
          speakingTimeoutRef.current,
        );

        speakingTimeoutRef.current =
          null;
      }
    };


  /*
   * ------------------------------------------------------------------------
   * WebSocket face control
   * ------------------------------------------------------------------------
   *
   * pose
   *   -> bindings
   *   -> animateValue()
   *
   * gaze
   *   -> controls
   *   -> setInput()
   *
   * say
   *   -> Coqui has already generated/played
   *      the audio.
   *   -> Start the browser viseme clock.
   */

  const { sendMessage } =
    useWebSocketFaceControl({
      enabled: ready,
      bindings,
      controls,
      setInput,
      animateValue,

      onSay: async (
        incomingText,
        _incomingVoice,
        incomingDuration,
      ) => {
        const cleanText =
          incomingText.trim();

        if (!cleanText) {
          console.warn(
            "[FaceApp] ignoring empty speech message",
          );

          return;
        }

        const duration =
          Number(
            incomingDuration,
          );

        if (
          !Number.isFinite(
            duration,
          ) ||
          duration <= 0
        ) {
          console.warn(
            "[FaceApp] invalid Coqui speech duration:",
            incomingDuration,
          );

          return;
        }

        console.log(
          "[FaceApp] Coqui speech received:",
          {
            text: cleanText,
            duration,
          },
        );

        /*
         * A new sequence number is important even when
         * the exact same sentence is spoken twice.
         */

        setSpeech(
          (previous) => ({
            text: cleanText,
            duration,
            startedAt:
              performance.now(),
            sequence:
              previous.sequence + 1,
          }),
        );

        clearSpeakingTimeout();

        setIsSpeaking(true);

        /*
         * This timeout only controls the browser's
         * speaking state.
         *
         * The actual mouth clock is controlled by
         * useVisemeMouth.
         */

        speakingTimeoutRef.current =
          window.setTimeout(
            () => {
              speakingTimeoutRef.current =
                null;

              setIsSpeaking(false);
            },
            Math.ceil(
              duration * 1000,
            ),
          );
      },
      onVisemesEnabled:
        setVisemesEnabled,

      onGaze: (gaze) => {
        console.log(
          "[FaceApp] Gaze received:",
          gaze,
        );

        setGazePolicy(
          gaze.policy ?? null,
        );

        // We will put the actual Vizij gaze-policy
        // behaviour here.
      },
    });

  /*
   * ------------------------------------------------------------------------
   * Viseme mouth
   * ------------------------------------------------------------------------
   *
   * Coqui mode:
   *
   *   speech.text
   *   speech.duration
   *   speech.startedAt
   *   speech.sequence
   *
   * are used to drive the mouth animation.
   */

  useVisemeMouth({
    audioManager,

    currentOutput:
      speech.text,

    speechDuration:
      speech.duration,

    speechStartedAt:
      speech.startedAt,

    speechSequence:
      speech.sequence,

    enabled: ready && visemesEnabled,

    /*
     * Current Coqui configuration.
     *
     * These are kept as constants for now so the
     * mouth behaviour remains identical to the
     * existing setup.
     */

    mode: "baseline",

    transitionMs: 360,

    leadMs: 450,

    sendMessage,
  });

  /*
   * ------------------------------------------------------------------------
   * Cleanup
   * ------------------------------------------------------------------------
   */

  useEffect(() => {
    return () => {
      clearSpeakingTimeout();
    };
  }, []);

  /*
   * ------------------------------------------------------------------------
   * Runtime loading/error states
   * ------------------------------------------------------------------------
   */

  if (loading) {
    return (
      <div className="fullscreen">
        <div className="status">
          Loading face…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fullscreen">
        <div className="status error hud-error">
          {error.message}
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="fullscreen">
        <div className="status">
          Initialising runtime…
        </div>
      </div>
    );
  }

  /*
   * ------------------------------------------------------------------------
   * Main UI
   * ------------------------------------------------------------------------
   */

  return (
    <div className="fullscreen">
      <div className="canvas-wrapper">
        <VizijRuntimeFace
          className="face-canvas"
          showSafeArea={false}
          modelScale={1.5}
        />
      </div>
    </div>
  );
}

/*
 * --------------------------------------------------------------------------
 * Application root
 * --------------------------------------------------------------------------
 */

export function FaceApp() {
  return (
    <VizijRuntimeProvider
      assetBundle={assetBundle}
      autostart
    >
      <AgentFaceRuntime />
    </VizijRuntimeProvider>
  );
}