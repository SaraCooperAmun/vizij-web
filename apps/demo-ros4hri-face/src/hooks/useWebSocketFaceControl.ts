import { useEffect, useRef } from "react";
import {
  mapNormalizedControlValue,
  resolveFaceControls,
} from "@vizij/runtime-react";

type PoseBinding = {
  semanticKey?: string;
  weightPath: string;
};

type GazeTarget = {
  frame_id: string;
  x: number;
  y: number;
  z: number;
};

type GazeMessage = {
  type: "gaze";
  x?: number;
  y?: number;
  policy?: string;
  target?: GazeTarget;
};

type PoseMessage = {
  type: "pose";
  semanticKey: string;
  value: number;
};

type SayMessage = {
  type: "say";
  text: string;
  voice?: string;
  duration: number;
};

type VisemesEnabledMessage = {
  type: "visemes_enabled";
  enabled: boolean;
};

type WebSocketMessage =
  | GazeMessage
  | PoseMessage
  | SayMessage
  | VisemesEnabledMessage;

type FaceControls =
  ReturnType<typeof resolveFaceControls>;


type SetInput = (
  path: string,
  value: { float: number },
) => void;

type AnimateValue = (
  path: string,
  value: { float: number },
  options?: {
    duration?: number;
  },
) => void;

type Options = {
  enabled: boolean;
  bindings: PoseBinding[];
  controls: FaceControls;
  setInput: SetInput;
  animateValue: AnimateValue;
  onSay?: (
    text: string,
    voice?: string,
    duration?: number,
  ) => void | Promise<void>;
  onVisemesEnabled?: (
    enabled: boolean,
  ) => void;
  onGaze?: (
    gaze: {
      x?: number;
      y?: number;
      policy?: string;
      target?: GazeTarget;
    },
  ) => void;
};

const WS_URL =
  import.meta.env.VITE_FACE_WS_URL ??
  "ws://192.168.50.201:9001";

function clamp(
  value: number,
  min: number,
  max: number,
) {
  return Math.max(
    min,
    Math.min(max, value),
  );
}

export function useWebSocketFaceControl({
  enabled,
  bindings,
  controls,
  setInput,
  animateValue,
  onSay,
  onVisemesEnabled,
  onGaze,
}: Options) {
  /*
   * ------------------------------------------------------------------------
   * Refs
   * ------------------------------------------------------------------------
   */

  const bindingsRef =
    useRef(bindings);

  const controlsRef =
    useRef(controls);

  const setInputRef =
    useRef(setInput);

  const animateValueRef =
    useRef(animateValue);

  const onSayRef =
    useRef(onSay);

  const onVisemesEnabledRef =
    useRef(onVisemesEnabled);

  const onGazeRef = useRef(onGaze);

  const wsRef =
    useRef<WebSocket | null>(null);

  /*
   * ------------------------------------------------------------------------
   * Keep refs up to date
   * ------------------------------------------------------------------------
   */

  useEffect(() => {
    bindingsRef.current =
      bindings;
  }, [bindings]);

  useEffect(() => {
    controlsRef.current =
      controls;
  }, [controls]);

  useEffect(() => {
    setInputRef.current =
      setInput;
  }, [setInput]);

  useEffect(() => {
    animateValueRef.current =
      animateValue;
  }, [animateValue]);

  useEffect(() => {
    onSayRef.current =
      onSay;
  }, [onSay]);

  useEffect(() => {
    onVisemesEnabledRef.current =
      onVisemesEnabled;
  }, [onVisemesEnabled]);

  useEffect(() => {
    onGazeRef.current = onGaze;
  }, [onGaze]);
  /*
   * ------------------------------------------------------------------------
   * WebSocket
   * ------------------------------------------------------------------------
   */

  useEffect(() => {
    if (!enabled) {
      console.log(
        "[face-ws] disabled",
      );

      return;
    }

    console.log(
      "[face-ws] connecting:",
      WS_URL,
    );

    const ws =
      new WebSocket(WS_URL);

    wsRef.current = ws;

    /*
     * ----------------------------------------------------------------------
     * OPEN
     * ----------------------------------------------------------------------
     */

    ws.onopen = () => {
      console.log(
        "[face-ws] connected:",
        WS_URL,
      );
    };

    /*
     * ----------------------------------------------------------------------
     * CLOSE
     * ----------------------------------------------------------------------
     */

    ws.onclose = (
      event,
    ) => {
      console.log(
        "[face-ws] disconnected:",
        {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        },
      );

      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };

    /*
     * ----------------------------------------------------------------------
     * ERROR
     * ----------------------------------------------------------------------
     */

    ws.onerror = (
      event,
    ) => {
      console.error(
        "[face-ws] error:",
        event,
      );
    };

    /*
     * ----------------------------------------------------------------------
     * MESSAGE
     * ----------------------------------------------------------------------
     */

    ws.onmessage = (
      event,
    ) => {
      let data: WebSocketMessage;

      /*
       * Parse JSON
       */

      try {
        data =
          JSON.parse(
            event.data,
          );
      } catch (error) {
        console.warn(
          "[face-ws] invalid JSON:",
          event.data,
          error,
        );

        return;
      }

      console.log(
        "[face-ws] message:",
        data,
      );

      /*
       * --------------------------------------------------------------------
       * POSE
       * --------------------------------------------------------------------
       */

if (data.type === "pose") {
  console.log("GOT POSE");

  // Reset all poses instantly
  bindingsRef.current.forEach(b => {
    animateValueRef.current(b.weightPath, { float: 0 }, { duration: 0 });
  });

  const binding = bindingsRef.current.find(
    (item) => item.semanticKey === data.semanticKey
  );

  if (!binding) {
    console.warn("[face-ws] no pose binding for semanticKey:", data.semanticKey);
    return;
  }

  const path = binding.weightPath;

  if (typeof path !== "string" || path.length === 0) {
    console.error("[face-ws] pose binding has no valid weightPath:", {
      semanticKey: data.semanticKey,
      binding,
    });
    return;
  }

  console.log("[face-ws] pose:", {
    semanticKey: data.semanticKey,
    path,
    value: data.value,
  });

  // Animate the new pose
  animateValueRef.current(
    path,
    { float: data.value },
    { duration: 2 }
  );

  return;
}


      /*
       * --------------------------------------------------------------------
       * GAZE
       * --------------------------------------------------------------------
       */

if (data.type === "gaze") {
  // ---------------------------------------------------------------
  // Target gaze
  // ---------------------------------------------------------------

  if (
    typeof data.target === "object" &&
    data.target !== null
  ) {
    console.log(
      "[face-ws] gaze target:",
      data.target,
    );

    const {
      x,
      y,
      z,
    } = data.target;

    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number" ||
      Math.abs(z) < 1e-6
    ) {
      console.warn(
        "[face-ws] invalid gaze target:",
        data.target,
      );

      return;
    }

    const yaw = Math.atan2(x, z);
    const pitch = Math.atan2(y, z);

    const nx = clamp(yaw, -1, 1);
    const ny = clamp(-pitch, -1, 1);

    const setEye = (
      key:
        | "leftX"
        | "rightX"
        | "leftY"
        | "rightY",
    ) => {
      const control =
        controlsRef.current.eyes[key];

      if (!control) {
        console.warn(
          "[face-ws] eye control not found:",
          key,
        );

        return;
      }

      const normalizedValue =
        key === "leftX" ||
        key === "rightX"
          ? nx
          : ny;

      const value =
        mapNormalizedControlValue(
          control,
          normalizedValue,
        );

      setInputRef.current(
        control.path,
        {
          float: value,
        },
      );
    };

    setEye("leftX");
    setEye("rightX");
    setEye("leftY");
    setEye("rightY");

    return;
  }

  // ---------------------------------------------------------------
  // Policy gaze
  // ---------------------------------------------------------------

  if (typeof data.policy === "string") {
    console.log(
      "[face-ws] gaze policy:",
      data.policy,
    );

    onGazeRef.current?.({
      policy: data.policy || undefined,
      target: undefined,
    });

    return;
  }

  // ---------------------------------------------------------------
  // Direct normalized gaze
  // ---------------------------------------------------------------

  if (
    typeof data.x !== "number" ||
    typeof data.y !== "number"
  ) {
    console.warn(
      "[face-ws] invalid gaze message:",
      data,
    );

    return;
  }

  const x = clamp(
    data.x,
    -1,
    1,
  );

  const y = clamp(
    data.y,
    -1,
    1,
  );

  const setEye = (
    key:
      | "leftX"
      | "rightX"
      | "leftY"
      | "rightY",
  ) => {
    const control =
      controlsRef.current.eyes[key];

    if (!control) {
      console.warn(
        "[face-ws] eye control not found:",
        key,
      );

      return;
    }

    const normalizedValue =
      key === "leftX" ||
      key === "rightX"
        ? x
        : y;

    const value =
      mapNormalizedControlValue(
        control,
        normalizedValue,
      );

    setInputRef.current(
      control.path,
      {
        float: value,
      },
    );
  };

  setEye("leftX");
  setEye("rightX");
  setEye("leftY");
  setEye("rightY");

  return;
}

      /*
       * --------------------------------------------------------------------
       * SAY
       * --------------------------------------------------------------------
       */

      if (data.type === "visemes_enabled") {
        const enabled =
          Boolean(data.enabled);

        console.log(
          "[face-ws] visemes enabled:",
          enabled,
        );

        onVisemesEnabledRef.current?.(
          enabled,
        );

        return;
      }

      if (
        data.type ===
        "say"
      ) {
        console.log(
          "[face-ws] SAY received:",
          {
            text:
              data.text,
            voice:
              data.voice,
          },
        );

        const handler =
          onSayRef.current;

        if (!handler) {
          console.warn(
            "[face-ws] received say message but no onSay handler is configured",
          );

          return;
        }

        const duration =
          typeof data.duration === "number"
            ? data.duration
            : Number(data.duration);

        if (
          !Number.isFinite(duration) ||
          duration <= 0
        ) {
          console.warn(
            "[face-ws] invalid say duration:",
            data.duration,
          );

          return;
        }
        const text =
          typeof data.text ===
          "string"
            ? data.text.trim()
            : "";

        if (!text) {
          console.warn(
            "[face-ws] empty say message",
          );

          return;
        }

        console.log(
          "[face-ws] calling onSay:",
          {
            text,
            voice:
              data.voice,
          },
        );

        /*
         * onSay is async because FaceApp waits for
         * Gemini TTS + actual audio playback.
         *
         * We deliberately do not await it here.
         */

        void handler(
          text,
          data.voice,
          duration,
        );

        console.log(
          "[face-ws] onSay invoked",
        );

        return;
      }

      /*
       * --------------------------------------------------------------------
       * UNKNOWN MESSAGE
       * --------------------------------------------------------------------
       */

      console.warn(
        "[face-ws] unknown message type:",
        data,
      );
    };

    /*
     * ----------------------------------------------------------------------
     * CLEANUP
     * ----------------------------------------------------------------------
     */

    return () => {
      console.log(
        "[face-ws] closing connection",
      );

      if (
        wsRef.current ===
        ws
      ) {
        wsRef.current =
          null;
      }

      if (
        ws.readyState ===
          WebSocket.OPEN ||
        ws.readyState ===
          WebSocket.CONNECTING
      ) {
        ws.close();
      }
    };
  }, [enabled]);

  /*
   * ------------------------------------------------------------------------
   * Send message to Python
   * ------------------------------------------------------------------------
   */

  const sendMessage = (
    message: unknown,
  ) => {
    const ws =
      wsRef.current;

    if (!ws) {
      console.warn(
        "[face-ws] cannot send message: WebSocket is not connected",
      );

      return false;
    }

    if (
      ws.readyState !==
      WebSocket.OPEN
    ) {
      console.warn(
        "[face-ws] cannot send message: WebSocket is not open",
        {
          readyState:
            ws.readyState,
        },
      );

      return false;
    }

    console.log(
      "[face-ws] sending:",
      message,
    );

    ws.send(
      JSON.stringify(
        message,
      ),
    );

    return true;
  };

  return {
    sendMessage,
  };
}
