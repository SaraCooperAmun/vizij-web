# Demo ROS4HRI face

The **Demo ROS4HRI face** is a web-based robot face built with **Vizij** and integrated with ROS 2 through `vizij_face_bridge`.

It provides the visual embodiment of a tutorial agent: the robot can display emotions, look at targets, and synchronize facial animation with speech.

The face runs in the browser using `vizij-web`, while ROS 2 provides the high-level commands controlling the robot's behavior.

---

## How it works

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

The bridge listens for WebSocket connections on:

```text
ws://0.0.0.0:9001
```

`0.0.0.0` means that the bridge accepts connections on the robot's network interfaces.

The browser does **not** connect to `0.0.0.0`. It connects to the robot's actual IP address, for example:

```text
ws://192.168.50.201:9001
```

See the `vizij_face_bridge` README for the available ROS 2 commands.

### 3. `vizij-web`

`vizij-web` contains the actual web-based face.

The demo can be launched using:

```bash
pnpm run dev:demo-ros4hri-face --host
```

The web application runs locally at:

```text
http://localhost:5173
```

Firefox can then be opened in kiosk mode so that the face is displayed fullscreen.

---

# Configuration

The face can be configured through environment variables.

The main configuration variables are:

| Variable           | Purpose                                                   | Example                             |
| ------------------ | --------------------------------------------------------- | ----------------------------------- |
| `VIZIJ_REPO_DIR`   | Path to the `vizij-web` repository                        | `/home/nvidia/sara_vizij/vizij-web` |
| `VIZIJ_FACE_ASSET` | GLB filename used by the face                             | `emy.glb`                           |
| `VITE_FACE_WS_URL` | WebSocket URL used by the browser to connect to the robot | `ws://192.168.50.201:9001`          |

The ROS launcher sets these variables automatically.

---

## `VIZIJ_REPO_DIR`

Specifies where the `vizij-web` repository is located.

Example:

```bash
VIZIJ_REPO_DIR=/home/nvidia/sara_vizij/vizij-web
```

This allows the same ROS launcher to be used on robots where the web repository is installed in different locations.

---

## `VIZIJ_FACE_ASSET`

Specifies which GLB model should be loaded by the face.

The GLB files are stored in:

```text
demo-ros4hri/public/assets/
```

For example:

```text
demo-ros4hri/public/assets/
├── emy.glb
├── Quori_Current_Extended.glb
└── my_robot.glb
```

Example:

```bash
VIZIJ_FACE_ASSET=emy.glb
```

The React application receives this through the Vite variable:

```text
VITE_FACE_ASSET
```

and loads:

```text
/assets/<face_asset>
```

---

## `VITE_FACE_WS_URL`

Specifies the WebSocket endpoint that the browser uses to communicate with `vizij_face_bridge`.

For example:

```bash
VITE_FACE_WS_URL=ws://192.168.50.201:9001
```

This IP address depends on the robot.

The React application reads it using:

```ts
const WS_URL =
  import.meta.env.VITE_FACE_WS_URL ??
  "ws://localhost:9001";
```

When the application is started by the ROS launcher, `VITE_FACE_WS_URL` is automatically set to the configured robot IP.

---

# Starting the demo with the ROS launcher

The `vizij_ros_face_launcher` package can be used to start the complete system.

It:

1. Starts `vizij_face_bridge`.
2. Starts the `vizij-web` development server.
3. Passes the configured face model and robot IP to the web application.
4. Waits until the web server is ready.
5. Disables the GNOME on-screen keyboard.
6. Opens Firefox in kiosk mode.
7. Displays the ROS4HRI face demo.

### Default configuration

The launch file provides default values for the face model and robot IP.

Therefore the demo can be started with:

```bash
ros2 launch vizij_ros_face_launcher vizij_ros_face.launch.py
```

### Selecting a different robot

The robot IP can be changed using:

```bash
ros2 launch vizij_ros_face_launcher vizij_ros_face.launch.py \
  robot_ip:=192.168.50.202
```

### Selecting a different face

For example:

```bash
ros2 launch vizij_ros_face_launcher vizij_ros_face.launch.py \
  face_asset:=Quori_Current_Extended.glb
```

### Configuring everything

```bash
ros2 launch vizij_ros_face_launcher vizij_ros_face.launch.py \
  vizij_repo_dir:=/home/nvidia/sara_vizij/vizij-web \
  face_asset:=Quori_Current_Extended.glb \
  robot_ip:=192.168.50.202
```

---

# Starting without the ROS launcher

The system can also be started manually.

This is useful for development, testing, or when the ROS launcher is not being used.

## 1. Set the environment variables

Go to the `vizij-web` repository:

```bash
cd /home/nvidia/sara_vizij/vizij-web
```

Set the face model:

```bash
export VITE_FACE_ASSET=emy.glb
```

Set the robot WebSocket address:

```bash
export VITE_FACE_WS_URL=ws://192.168.50.201:9001
```

You can check the values with:

```bash
echo $VITE_FACE_ASSET
echo $VITE_FACE_WS_URL
```

You should see:

```text
emy.glb
ws://192.168.50.201:9001
```

## 2. Start the web application

```bash
pnpm run dev:demo-ros4hri-face --host
```

The browser application will be available at:

```text
http://localhost:5173
```

The face running in the browser will connect to:

```text
ws://192.168.50.201:9001
```

rather than `localhost:9001`.

## 3. Change the robot

For another robot, simply change the environment variable before starting Vite:

```bash
export VITE_FACE_WS_URL=ws://192.168.50.202:9001
pnpm run dev:demo-ros4hri-face --host
```

Vite environment variables are read when the development server starts, so restart Vite after changing them.

---

# What the face can do

## Expressions

The face can display different emotional expressions, such as:

* Happy
* Sad
* Angry
* Surprised
* Neutral
* Concerned
* Tired / sleepy

Expressions are sent from ROS 2 and translated by the bridge into Vizij face expressions.

## Look At

The face supports Look At behaviors through ROS 2 policies.

A policy can control how the face behaves when looking at something, and an optional target can specify where the robot should look.

## Speech and visemes

Speech is handled by a separate TTS component such as `tts_ros` or `emojivoice_tts`.

The TTS system provides speech information to the bridge, which forwards it to the web face.

Visemes can be enabled or disabled through ROS 2 and are used to synchronize the mouth animation with speech.

---

# Changing the face model

GLB models are stored in:

```text
demo-ros4hri/public/assets/
```

For example:

```text
demo-ros4hri/public/assets/my_robot.glb
```

When using the ROS launcher, select the model with:

```bash
ros2 launch vizij_ros_face_launcher vizij_ros_face.launch.py \
  face_asset:=my_robot.glb
```

When running manually, set:

```bash
export VITE_FACE_ASSET=my_robot.glb
```

and then start Vite:

```bash
pnpm run dev:demo-ros4hri-face --host
```

There is no need to copy the GLB files into the ROS launcher package.

---

# Architecture

```text
                     ┌──────────────────────┐
                     │        ROS 2         │
                     │                      │
                     │ interaction_skills   │
                     │ communication_skills │
                     │ TTS                  │
                     └──────────┬───────────┘
                                │
                                │ ROS 2
                                ▼
                     ┌──────────────────────┐
                     │  vizij_face_bridge   │
                     │                      │
                     │ WebSocket :9001      │
                     └──────────┬───────────┘
                                │
                                │ WebSocket
                                │
                                │ ws://ROBOT_IP:9001
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

The important separation is:

* **ROS 2** controls the robot's behavior.
* **`vizij_face_bridge`** translates ROS 2 commands into WebSocket messages.
* **`vizij-web`** renders the actual face.
* **Firefox** displays the face.

---

# Related packages

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
