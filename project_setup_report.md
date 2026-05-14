# 📑 SmartGuard Project Setup & Technical Report

This document provides a detailed breakdown of the work performed to prepare and upload the **SmartGuard** project to GitHub, along with an explanation of the project's architecture and tools used.

---

## 1. Summary of Actions Taken

To transition this project from a local folder to a professional GitHub repository, the following steps were performed:

1.  **Environment Audit**: Scanned the project directory to identify core components (Firmware, Dashboard, Simulation files) and checked for sensitive information.
2.  **Git Initialization**:
    *   Initialized a local Git repository (`git init`).
    *   Renamed the default branch to `main` to align with modern standards.
3.  **Clean Repository Setup**:
    *   Created a `.gitignore` file to ensure IDE settings (`.vscode`), system logs, and future dependencies (`node_modules`) are not uploaded.
4.  **Aesthetic Enhancement**:
    *   Used AI image generation to create a professional **dashboard mockup** (`screenshot.png`).
    *   Placed this image in the root directory to serve as a visual header for the repository.
5.  **Professional Documentation**:
    *   Created a high-quality `README.md` using Markdown. This document explains the project's purpose, features, and setup instructions.
6.  **GitHub Deployment**:
    *   Staged and committed all files.
    *   Linked the local repository to `https://github.com/AlankritaS26/SmartGuard.git`.
    *   Pushed all code and assets to the cloud.

---

## 2. Tools & Technologies Used

### Core Development Tools
*   **Git**: Used for version control, tracking changes, and pushing code to GitHub.
*   **PowerShell**: Used to execute system-level commands for file management and repository configuration.
*   **AI Image Generator**: Used to create a high-fidelity visual representation of the project's dashboard.

### Project Stack (The "Under the Hood" Tech)
*   **C++ (Arduino)**: The language used for the **ESP32 Firmware**. It handles low-level sensor reading and logic.
*   **Vanilla JavaScript**: Drives the **Web Dashboard** without needing heavy frameworks, ensuring fast load times.
*   **Firebase Realtime Database**: Acts as the "brain" in the cloud, allowing the ESP32 and the Web Dashboard to talk to each other instantly.
*   **Chart.js**: A powerful library used in the dashboard to render the real-time electrical current graphs.
*   **Wokwi**: A browser-based hardware simulator that allows testing the ESP32 code without needing physical wires or sensors.

---

## 3. Detailed Component Explanation

### 🛰️ Firmware (`/firmware`)
The ESP32 runs a continuous loop that performs three main tasks:
1.  **Sampling**: It reads raw data from the current sensor and check for button presses (Acoustic/Tamper).
2.  **Classification (Edge AI)**: It uses a "TinyML" logic pattern to decide if the appliance is `Healthy`, `Warning` (high current or strange noise), or `Critical` (impending failure).
3.  **Communication**: It uses WiFi and a REST API to send this data to Firebase every 2 seconds.

### 📊 Dashboard (`/dashboard`)
The dashboard is the user-facing part of the project:
*   **Live Mode**: Connects to your Firebase URL to show real data from the ESP32.
*   **Demo Mode**: If no hardware is connected, it runs a "Demo Engine" that generates realistic synthetic data so you can still demonstrate the project's features.
*   **Confidence Ring**: Visualizes how "sure" the AI is about the current health status.

### 🔒 Tamper & Security
A unique feature of SmartGuard is the **Tamper Detection**. If someone physically opens the device, the ESP32 enters a "Locked Out" state. This state is pushed to Firebase and immediately reflects on the dashboard, preventing further operation until an administrator resets it.

### ☁️ Firebase & Setup (`/firebase`)
The project uses **Security Rules** to ensure that only authorized devices can write data. The `database.rules.json` file in this folder defines those permissions.

---

## 4. How to Refer to Your Work
If you are presenting this project (e.g., for a class or portfolio), you can explain it as:
> *"SmartGuard is an AIoT health monitoring system. I used an ESP32 for edge classification, Firebase for real-time cloud synchronization, and a custom JavaScript dashboard for data visualization. I managed the project using Git and GitHub, ensuring a clean and professional documentation structure."*
