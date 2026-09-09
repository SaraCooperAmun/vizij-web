import { useEffect, useRef } from "react";
import {
  buildSemanticPoseWeightPathMap,
  useVizijRuntime,
} from "@vizij/runtime-react";

import {
  PHONEME_TO_VISEME,
  buildPhonemeTimeline,
  alignVisemes,
  synthesizePhonemes,
  type SynthFrame,
  type VisemeId,
  type Phoneme,
  type PhonemeEvent,
} from "../phoneme-core";

import type { AudioManager } from "../utils/audioManager";

import {
  FACE_VISEME_SEGMENTS,
  mapPollyViseme,
} from "../visemeMapping";

const DEFAULT_POSE_WEIGHT = 0.7;

type SpeechWord = {
  index: number;
  text: string;
  startTime: number;
  endTime: number;
};

type VisemeKeyframe = {
  viseme: VisemeId;
  start: number;
  end: number;
};

/*
 * --------------------------------------------------------------------------
 * GLOBAL SPEECH-WORD DEDUPLICATION
 * --------------------------------------------------------------------------
 *
 * IMPORTANT:
 *
 * This is intentionally outside useVisemeMouth().
 *
 * A useRef() belongs to one hook instance. If the hook is mounted twice,
 * both instances would otherwise have their own Set and both could publish
 * the same word.
 *
 * Keeping this Set at module level means:
 *
 *   hook instance A -> "hello" -> SEND
 *   hook instance B -> "hello" -> BLOCK
 *
 * A new Coqui utterance gets a different speechStartedAt value, so the same
 * text can still be spoken again normally.
 *
 * The Set is bounded so it cannot grow forever.
 */

const sentSpeechWordKeys = new Set<string>();

const MAX_SPEECH_WORD_KEYS = 5000;

function wasSpeechWordAlreadySent(
  key: string,
): boolean {
  if (
    sentSpeechWordKeys.has(key)
  ) {
    return true;
  }

  /*
   * Prevent unlimited memory growth.
   */
  if (
    sentSpeechWordKeys.size >=
    MAX_SPEECH_WORD_KEYS
  ) {
    const firstKey =
      sentSpeechWordKeys.values().next()
        .value;

    if (firstKey) {
      sentSpeechWordKeys.delete(
        firstKey,
      );
    }
  }

  sentSpeechWordKeys.add(key);

  return false;
}

/*
 * If the WebSocket send fails, remove the key so another hook/effect can
 * retry the message.
 */
function removeSpeechWordKey(
  key: string,
) {
  sentSpeechWordKeys.delete(key);
}

export function useVisemeMouth({
  audioManager,
  currentOutput,
  speechDuration,
  speechStartedAt,
  speechSequence,
  enabled,
  mode,
  transitionMs,
  leadMs,
  sendMessage,
}: {
  audioManager: AudioManager;

  currentOutput: string;

  speechDuration: number;

  speechStartedAt: number;

  speechSequence: number;

  enabled: boolean;

  mode: "baseline" | "synth" | "align";

  transitionMs: number;

  leadMs: number;

  sendMessage: (
    message: unknown,
  ) => boolean;
}) {
  const {
    setInput,
    animateValue,
    faceId,
    assetBundle,
  } = useVizijRuntime();

  const outputRef =
    useRef(currentOutput);

  const speechDurationRef =
    useRef(speechDuration);

  const speechStartedAtRef =
    useRef(speechStartedAt);

  const speechSequenceRef =
    useRef(speechSequence);

  /*
   * Persistent Gemini playback state.
   */
  const geminiPreviousPlayedRef =
    useRef(0);

  const geminiPreviousTotalRef =
    useRef(0);

  const geminiPreviousIsPlayingRef =
    useRef(false);

  /*
   * Keep latest values available to animation loop.
   */

  useEffect(() => {
    outputRef.current =
      currentOutput;
  }, [currentOutput]);

  useEffect(() => {
    speechDurationRef.current =
      speechDuration;
  }, [speechDuration]);

  useEffect(() => {
    speechStartedAtRef.current =
      speechStartedAt;
  }, [speechStartedAt]);

  useEffect(() => {
    speechSequenceRef.current =
      speechSequence;
  }, [speechSequence]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let raf: number;

    const poseConfig =
      assetBundle.pose?.config ?? null;

    const poseWeightPaths =
      buildSemanticPoseWeightPathMap(
        poseConfig?.poses ?? [],
        poseConfig?.poseGroups,
        poseConfig?.faceId ??
          faceId ??
          "face",
        "viseme",
      );

    const resolveSegmentPath =
      (segment: string) =>
        poseWeightPaths.get(segment) ??
        poseWeightPaths.get(
          `pose_${segment}`,
        ) ??
        null;

    const visemePaths =
      FACE_VISEME_SEGMENTS
        .map(resolveSegmentPath)
        .filter(Boolean) as string[];

    /*
     * ----------------------------------------------------------------------
     * Timeline state
     * ----------------------------------------------------------------------
     */

    let lastFrameCount = -1;

    let lastFeatureCount = -1;

    let lastOutput = "";

    let lastSpeechDuration = -1;

    let lastSpeechStartedAt = -1;

    let lastSpeechSequence = -1;

    let keyframes: VisemeKeyframe[] =
      [];

    let activePath: string | null =
      null;

    let words: SpeechWord[] =
      [];

    let lastSentWordIndex = -1;

    /*
     * ----------------------------------------------------------------------
     * Gemini playback state
     * ----------------------------------------------------------------------
     */

    let previousPlayed =
      geminiPreviousPlayedRef.current;

    let previousTotal =
      geminiPreviousTotalRef.current;

    let previousIsPlaying =
      geminiPreviousIsPlayingRef.current;

    /*
     * ----------------------------------------------------------------------
     * Coqui speech state
     * ----------------------------------------------------------------------
     */

    let activeSpeechSequence =
      -1;

    let coquiSpeechFinished =
      false;

    /*
     * ----------------------------------------------------------------------
     * Reset viseme paths
     * ----------------------------------------------------------------------
     */

    const zeroAll = () => {
      visemePaths.forEach(
        (path) =>
          setInput(path, {
            float: 0,
          }),
      );

      activePath = null;
    };

    /*
     * ----------------------------------------------------------------------
     * Build timeline
     * ----------------------------------------------------------------------
     */

    const rebuildKeyframes = () => {
      const frames =
        audioManager.getPhonemeFrames();

      const features =
        audioManager.getFeatureFrames();

      const playback =
        audioManager.getPlaybackState();

      const text =
        outputRef.current;

      const coquiDuration =
        speechDurationRef.current;

      const coquiStartedAt =
        speechStartedAtRef.current;

      const coquiSequence =
        speechSequenceRef.current;

      const hasCoquiSpeech =
        coquiDuration > 0 &&
        coquiStartedAt > 0 &&
        coquiSequence > 0;

      let totalDuration: number;

      if (hasCoquiSpeech) {
        totalDuration =
          Math.max(
            coquiDuration,
            0.1,
          );
      } else {
        const lastFrameTime =
          frames.length
            ? frames[
                frames.length - 1
              ].time
            : 0;

        const lastFeatureTime =
          features.length
            ? features[
                features.length - 1
              ].time
            : 0;

        totalDuration =
          Math.max(
            playback.total,
            lastFrameTime,
            lastFeatureTime,
            0.1,
          );
      }

      const baseline =
        buildPhonemeTimeline(
          text,
          totalDuration,
        );

      const textEvents =
        baseline.events as PhonemeEvent[];

      /*
       * ------------------------------------------------------------------
       * Build words
       * ------------------------------------------------------------------
       */

      words = (
        baseline.words ?? []
      )
        .filter((word) => {
          return (
            typeof word.text ===
              "string" &&
            word.text.trim()
              .length > 0 &&
            !word.isPunct
          );
        })
        .map(
          (word, index) => ({
            index,
            text: word.text.trim(),
            startTime:
              word.startTime,
            endTime:
              word.endTime,
          }),
        );

      /*
       * ------------------------------------------------------------------
       * Detect new speech event
       * ------------------------------------------------------------------
       */

      const newCoquiSpeech =
        hasCoquiSpeech &&
        coquiSequence !==
          lastSpeechSequence;

      const outputChanged =
        text !== lastOutput;

      const durationChanged =
        coquiDuration !==
        lastSpeechDuration;

      const startTimeChanged =
        coquiStartedAt !==
        lastSpeechStartedAt;

      if (
        outputChanged ||
        newCoquiSpeech ||
        durationChanged ||
        startTimeChanged
      ) {
        lastSentWordIndex = -1;

        previousPlayed = 0;

        previousTotal = 0;

        previousIsPlaying =
          false;

        if (newCoquiSpeech) {
          activeSpeechSequence =
            coquiSequence;

          coquiSpeechFinished =
            false;
        }
      }

      /*
       * ------------------------------------------------------------------
       * Gemini alignment
       * ------------------------------------------------------------------
       */

      let built = false;

      if (
        !hasCoquiSpeech &&
        mode === "align" &&
        frames.length > 0 &&
        features.length > 1 &&
        textEvents.length > 0
      ) {
        const started =
          performance.now();

        const phonemes =
          textEvents.map(
            (evt) =>
              evt.phoneme as Phoneme,
          );

        const wordIdx =
          textEvents.map(
            (evt) =>
              evt.wordIndex,
          );

        const {
          events: aligned,
        } = alignVisemes(
          features,
          frames,
          phonemes,
          wordIdx,
          {
            durationGuide:
              textEvents,
          },
        );

        const runtime =
          performance.now() -
          started;

        if (
          aligned.length &&
          runtime <= 30
        ) {
          keyframes =
            aligned.map(
              (evt) => ({
                viseme:
                  PHONEME_TO_VISEME[
                    evt.phoneme as Phoneme
                  ],

                start:
                  evt.startTime,

                end:
                  evt.endTime,
              }),
            );

          built = true;
        }
      }

      /*
       * ------------------------------------------------------------------
       * Synth mode
       * ------------------------------------------------------------------
       */

      if (!built) {
        const useSynth =
          !hasCoquiSpeech &&
          mode === "synth" &&
          frames.length > 0;

        if (useSynth) {
          const synthFrames =
            synthesizePhonemes(
              frames,
              textEvents,
              20,
            );

          keyframes =
            synthFramesToEvents(
              synthFrames,
              0.02,
            );
        } else {
          keyframes =
            baseline.events.map(
              (evt) => ({
                viseme:
                  PHONEME_TO_VISEME[
                    evt.phoneme as Phoneme
                  ],

                start:
                  evt.startTime,

                end:
                  evt.endTime,
              }),
            );
        }
      }

      /*
       * Save rebuild state.
       */

      lastFrameCount =
        frames.length;

      lastFeatureCount =
        features.length;

      lastOutput =
        text;

      lastSpeechDuration =
        coquiDuration;

      lastSpeechStartedAt =
        coquiStartedAt;

      lastSpeechSequence =
        coquiSequence;
    };

    /*
     * ----------------------------------------------------------------------
     * Send speech word
     * ----------------------------------------------------------------------
     */

    const sendSpeechWord = (
      word: SpeechWord,
      key: string,
    ) => {
      const cleanWord =
        word.text.trim();

      if (!cleanWord) {
        return;
      }

      /*
       * GLOBAL DEDUPLICATION
       *
       * This catches duplicates even when TWO useVisemeMouth()
       * instances are mounted.
       */

      if (
        wasSpeechWordAlreadySent(key)
      ) {
        console.warn(
          "[VisemeMouth] BLOCKED duplicate speech_word:",
          cleanWord,
          "key:",
          key,
        );

        return;
      }

      const sent =
        sendMessage({
          type: "speech_word",
          word: cleanWord,
        });

      if (sent) {
        console.log(
          "[VisemeMouth] speech_word:",
          cleanWord,
          "key:",
          key,
        );
      } else {
        /*
         * Sending failed.
         *
         * Allow another attempt.
         */
        removeSpeechWordKey(key);

        console.warn(
          "[VisemeMouth] could not send speech_word:",
          cleanWord,
          "key:",
          key,
        );
      }
    };

    /*
     * ----------------------------------------------------------------------
     * Gemini speech word timing
     * ----------------------------------------------------------------------
     */

    const updateGeminiSpeechWord =
      (
        played: number,
        isPlaying: boolean,
        total: number,
      ) => {
        const playbackRestarted =
          played <
            previousPlayed -
              0.05 ||
          total !== previousTotal;

        if (
          playbackRestarted
        ) {
          lastSentWordIndex = -1;
        }

        if (
          isPlaying &&
          !previousIsPlaying &&
          played < 0.1
        ) {
          lastSentWordIndex = -1;
        }

        if (
          isPlaying &&
          words.length > 0
        ) {
          while (
            lastSentWordIndex + 1 <
              words.length &&
            played >=
              words[
                lastSentWordIndex + 1
              ].startTime
          ) {
            const nextIndex =
              lastSentWordIndex + 1;

            sendSpeechWord(
              words[nextIndex],
              `gemini:${outputRef.current}:${total}:${nextIndex}`,
            );

            lastSentWordIndex =
              nextIndex;
          }
        }

        previousPlayed =
          played;

        previousTotal =
          total;

        previousIsPlaying =
          isPlaying;

        geminiPreviousPlayedRef.current =
          previousPlayed;

        geminiPreviousTotalRef.current =
          previousTotal;

        geminiPreviousIsPlayingRef.current =
          previousIsPlaying;
      };

    /*
     * ----------------------------------------------------------------------
     * Coqui speech word timing
     * ----------------------------------------------------------------------
     */

    const updateCoquiSpeechWord =
      (
        played: number,
        isPlaying: boolean,
        total: number,
        sequence: number,
      ) => {
        if (
          sequence !==
          activeSpeechSequence
        ) {
          activeSpeechSequence =
            sequence;

          lastSentWordIndex = -1;

          coquiSpeechFinished =
            false;
        }

        if (
          isPlaying &&
          words.length > 0
        ) {
          while (
            lastSentWordIndex + 1 <
              words.length &&
            played >=
              words[
                lastSentWordIndex + 1
              ].startTime
          ) {
            const nextIndex =
              lastSentWordIndex + 1;

            /*
             * Include speechStartedAt in the key.
             *
             * This identifies the actual utterance, not just the
             * sequence number.
             */
            const wordKey =
              `coqui:${sequence}:${speechStartedAtRef.current}:${nextIndex}`;

            sendSpeechWord(
              words[nextIndex],
              wordKey,
            );

            lastSentWordIndex =
              nextIndex;
          }
        }

        if (
          !isPlaying &&
          played >= total
        ) {
          coquiSpeechFinished =
            true;
        }
      };

    /*
     * ----------------------------------------------------------------------
     * Animate viseme switch
     * ----------------------------------------------------------------------
     */

    const animateSwitch = (
      nextPath: string | null,
    ) => {
      const dur =
        Math.max(
          transitionMs / 1000,
          0.01,
        );

      if (
        activePath &&
        activePath !== nextPath
      ) {
        void animateValue(
          activePath,
          {
            float: 0,
          },
          {
            duration: dur,
          },
        );
      }

      if (
        nextPath &&
        nextPath !== activePath
      ) {
        void animateValue(
          nextPath,
          {
            float:
              DEFAULT_POSE_WEIGHT,
          },
          {
            duration: dur,
          },
        );
      }

      activePath =
        nextPath;
    };

    /*
     * ----------------------------------------------------------------------
     * Animation loop
     * ----------------------------------------------------------------------
     */

    const tick = () => {
      const frames =
        audioManager.getPhonemeFrames();

      const features =
        audioManager.getFeatureFrames();

      const coquiDuration =
        speechDurationRef.current;

      const coquiStartedAt =
        speechStartedAtRef.current;

      const coquiSequence =
        speechSequenceRef.current;

      const hasCoquiSpeech =
        coquiDuration > 0 &&
        coquiStartedAt > 0 &&
        coquiSequence > 0;

      /*
       * Rebuild timeline when necessary.
       */

      if (
        frames.length !==
          lastFrameCount ||
        features.length !==
          lastFeatureCount ||
        outputRef.current !==
          lastOutput ||
        coquiDuration !==
          lastSpeechDuration ||
        coquiStartedAt !==
          lastSpeechStartedAt ||
        coquiSequence !==
          lastSpeechSequence
      ) {
        rebuildKeyframes();
      }

      /*
       * --------------------------------------------------------------
       * Current speech time
       * --------------------------------------------------------------
       */

      let played: number;

      let total: number;

      let isPlaying: boolean;

      if (hasCoquiSpeech) {
        const elapsed =
          (
            performance.now() -
            coquiStartedAt
          ) / 1000;

        total =
          Math.max(
            coquiDuration,
            0.1,
          );

        played =
          Math.max(
            0,
            Math.min(
              elapsed,
              total,
            ),
          );

        isPlaying =
          elapsed <
          total;
      } else {
        const playback =
          audioManager.getPlaybackState();

        played =
          playback.played;

        total =
          playback.total;

        isPlaying =
          playback.isPlaying;

        updateGeminiSpeechWord(
          played,
          isPlaying,
          total,
        );
      }

      /*
       * Coqui word timing.
       */

      if (hasCoquiSpeech) {
        updateCoquiSpeechWord(
          played,
          isPlaying,
          total,
          coquiSequence,
        );
      }

      /*
       * --------------------------------------------------------------
       * Viseme lead
       * --------------------------------------------------------------
       */

      const t =
        played +
        leadMs / 1000;

      const idx =
        findKeyframeIndex(
          keyframes,
          t,
        );

      const viseme =
        hasCoquiSpeech &&
        !isPlaying &&
        played >= total
          ? "sil"
          : idx >= 0
            ? keyframes[idx].viseme
            : "sil";

      const targetSegment =
        mapPollyViseme(
          viseme,
        )?.segment ?? null;

      const nextPath =
        targetSegment
          ? resolveSegmentPath(
              targetSegment,
            )
          : null;

      animateSwitch(
        nextPath,
      );

      raf =
        requestAnimationFrame(
          tick,
        );
    };

    /*
     * ----------------------------------------------------------------------
     * Initial timeline
     * ----------------------------------------------------------------------
     */

    rebuildKeyframes();

    raf =
      requestAnimationFrame(
        tick,
      );

    /*
     * ----------------------------------------------------------------------
     * Cleanup
     * ----------------------------------------------------------------------
     */

    return () => {
      cancelAnimationFrame(
        raf,
      );

      zeroAll();
    };
  }, [
    animateValue,
    audioManager,
    assetBundle.pose?.config,
    enabled,
    faceId,
    leadMs,
    mode,
    sendMessage,
    setInput,
    transitionMs,
  ]);
}

/*
 * --------------------------------------------------------------------------
 * Convert synthesized audio frames into contiguous viseme events.
 * --------------------------------------------------------------------------
 */

function synthFramesToEvents(
  frames: SynthFrame[],
  fallbackStep: number,
): VisemeKeyframe[] {
  if (!frames.length) {
    return [];
  }

  const events: VisemeKeyframe[] =
    [];

  let current:
    | VisemeKeyframe
    | null = null;

  frames.forEach(
    (frame, idx) => {
      const nextTime =
        idx <
        frames.length - 1
          ? frames[idx + 1].time
          : frame.time +
            fallbackStep;

      if (!current) {
        current = {
          viseme:
            frame.viseme,

          start:
            frame.time,

          end:
            nextTime,
        };

        return;
      }

      if (
        frame.viseme ===
        current.viseme
      ) {
        current.end =
          nextTime;
      } else {
        events.push(
          current,
        );

        current = {
          viseme:
            frame.viseme,

          start:
            frame.time,

          end:
            nextTime,
        };
      }
    },
  );

  if (current) {
    events.push(
      current,
    );
  }

  return events;
}

/*
 * --------------------------------------------------------------------------
 * Find the viseme active at a given point in time.
 * --------------------------------------------------------------------------
 */

function findKeyframeIndex(
  frames: VisemeKeyframe[],
  t: number,
): number {
  if (!frames.length) {
    return -1;
  }

  for (
    let i = 0;
    i < frames.length;
    i += 1
  ) {
    if (
      t >= frames[i].start &&
      t <= frames[i].end
    ) {
      return i;
    }
  }

  if (
    t <
    frames[0].start
  ) {
    return 0;
  }

  return frames.length - 1;
}