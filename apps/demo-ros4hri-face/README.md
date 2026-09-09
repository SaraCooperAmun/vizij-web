# Demo ROS4HRI face

The **Demo ROS4HRI face** is a web-based robot face built with **Vizij** and integrated with ROS 2 through `vizij_face_bridge`.

It provides the visual embodiment of a tutorial agent: the robot can display emotions, look at targets, and synchronize facial animation with speech.

The face runs in the browser using `vizij-web`, while ROS 2 provides the high-level commands controlling the robot's behavior.

---

## How it works

The system consists of three main components:

```text
ROS 2
  │
  │ ROS 2 topics / actions / services
  ▼
vizij_face_bridge
  │
  │ WebSocket
  ▼
vizij-web
  │
  ▼
Browser / Firefox
  │
  ▼
Tutorial Agent Face
```

### 1. ROS 2

The robot's interaction skills send commands through ROS 2.

Examples include:

* Setting an expression
* Controlling Look At behavior
* Sending speech commands
* Enabling/disabling visemes

The main interfaces are provided by `interaction_skills` and `communication_skills`.

### 2. `vizij_face_bridge`

`vizij_face_bridge` acts as the connection between ROS 2 and the web face.

It receives ROS 2 commands and converts them into messages understood by `vizij-web`.

The bridge communicates with the browser through a WebSocket connection on:

```text
ws://0.0.0.0:9001
```

For example, an expression command from ROS 2 is converted into a Vizij face expression.

The bridge also forwards speech information so that the face can synchronize its animation with TTS.

See the `vizij_face_bridge` README for the available ROS 2 commands.

### 3. `vizij-web`

`vizij-web` contains the actual web-based face.

The demo is launched using the ROS4HRI face demo:

```bash
pnpm run dev:demo-ros4hri-face --host
```

The web application runs locally at:

```text
http://localhost:5173
```

Firefox is then opened in kiosk mode so that the face is displayed fullscreen.

---

## What the face can do

The demo currently supports:

### Expressions

The face can display different emotional expressions, such as:

* Happy
* Sad
* Angry
* Surprised
* Neutral
* Concerned
* Tired / sleepy

Expressions are sent from ROS 2 and translated by the bridge into Vizij face commands.

### Look At

The face supports Look At behaviors through ROS 2 policies.

A policy can control how the face behaves when looking at something, and an optional target can specify where the robot should look.

### Speech and visemes

Speech is handled by a separate TTS component such as `tts_ros` or `emojivoice_tts`.

The TTS system provides the speech information to the bridge, which forwards it to the web face.

Visemes can be enabled or disabled through ROS 2 and are used to synchronize the mouth animation with speech.

---

## Starting the demo

The `vizij_ros_face_launcher` package can be used to start the complete system.

It:

1. Starts `vizij_face_bridge`.
2. Starts the `vizij-web` development server.
3. Waits until the web server is ready.
4. Disables the GNOME on-screen keyboard.
5. Opens Firefox in kiosk mode.
6. Displays the ROS4HRI face demo.

The launcher therefore provides a convenient way to start the complete face without manually starting each component.

See the `vizij_ros_face_launcher` README for installation and launch instructions.

---

## Architecture

```text
                     ┌──────────────────────┐
                     │       ROS 2          │
                     │                      │
                     │ interaction_skills   │
                     │ communication_skills │
                     │ TTS                  │
                     └──────────┬───────────┘
                                │
                                │ ROS 2
                                ▼
                     ┌──────────────────────┐
                     │ vizij_face_bridge    │
                     └──────────┬───────────┘
                                │
                                │ WebSocket
                                ▼
                     ┌──────────────────────┐
                     │      vizij-web       │
                     │                      │
                     │ ROS4HRI Face Demo    │
                     └──────────┬───────────┘
                                │
                                │ HTTP
                                ▼
                     ┌──────────────────────┐
                     │       Firefox        │
                     │      kiosk mode      │
                     └──────────────────────┘
```

The important separation is that **ROS 2 controls the behavior**, `vizij_face_bridge` translates the ROS commands, and **`vizij-web` renders the actual face**.

## Changing the face model

The face model used by the Tutorial Agent Face is currently configured directly in the vizij-web source code.

The model is selected in:

FaceApp.tsx

using:

const faceAssetUrl = new URL(
  "../../demo-ros4hri/public/assets/emy.glb",
  import.meta.url,
).href;

To use a different face model:

Add the new .glb file to:
demo-ros4hri/public/assets/

For example:

demo-ros4hri/public/assets/my_robot.glb
Update FaceApp.tsx:
const faceAssetUrl = new URL(
  "../../demo-ros4hri/public/assets/my_robot.glb",
  import.meta.url,
).href;
Restart the Vizij web server:
pnpm run dev:face-ros4hri-demo --host

The new GLB model will then be loaded by the web application.

---

## Related packages

The demo relies on the following ROS 2 packages:

```text
communication_skills/
emojivoice_tts/
vizij_ros_face_launcher/
interaction_skills/
tts_ros/
vizij_face_bridge/
```

The `vizij-web` project is maintained separately from the ROS 2 workspace.
