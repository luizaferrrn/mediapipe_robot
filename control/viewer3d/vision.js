
import {
    FilesetResolver,
    HandLandmarker
    } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/vision_bundle.mjs";

    // Elementos HTML
    const video = document.getElementById("visionVideo");
    const statusText = document.getElementById("visionStatus");
    const startButton = document.getElementById("visionStart");
    const stopButton = document.getElementById("visionStop");
    const cursor = document.getElementById("handCursor");

    // Canvas para visualizar los landmarks
    const landmarkCanvas = document.getElementById("handLandmarks");
    const ctx = landmarkCanvas.getContext("2d");

    function clearHandLandmarks() {
    if (!ctx || !landmarkCanvas) return;

    ctx.clearRect(
        0,
        0,
        landmarkCanvas.width,
        landmarkCanvas.height
    );
}

    // Conexiones de los 21 landmarks de MediaPipe Hand Landmarker
    const HAND_CONNECTIONS = [
    // Pulgar
        [0, 1], [1, 2], [2, 3], [3, 4],

        // Índice
        [0, 5], [5, 6], [6, 7], [7, 8],

        // Palma y dedo medio
        [5, 9], [9, 10], [10, 11], [11, 12],

        // Anular
        [9, 13], [13, 14], [14, 15], [15, 16],

        // Meñique
        [13, 17], [17, 18], [18, 19], [19, 20],

        // Unión de la palma
        [0, 17]
    ];


    // Variables de MediaPipe
    let handLandmarker = null;
    let cameraStream = null;
    let animationFrame = null;
    let running = false;
    let lastVideoTime = -1;

    // Variables del cursor
    let cursorX = window.innerWidth / 2;
    let cursorY = window.innerHeight / 2;
    let pinchActive = false;
    let lastClickTime = 0;

    // Distancia entre dos puntos
    function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
    }

    // Limitar valores
    function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
    }

    // Inicializar MediaPipe
    async function initializeMediaPipe() {
    if (handLandmarker) return;

    statusText.textContent = "Cargando modelo de MediaPipe...";

    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm"
    );

    const options = {
        baseOptions: {
        modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1
    };

    try {
        handLandmarker = await HandLandmarker.createFromOptions(
        vision,
        options
        );
    } catch (gpuError) {
        console.warn("GPU no disponible. Intentando con CPU.", gpuError);

        options.baseOptions.delegate = "CPU";

        handLandmarker = await HandLandmarker.createFromOptions(
        vision,
        options
        );
    }
    }

    // Activar cámara
    async function startVision() {
    try {
        await initializeMediaPipe();

        cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 }
        },
        audio: false
        });

        video.srcObject = cameraStream;
        await video.play();

        landmarkCanvas.width = video.videoWidth;
        landmarkCanvas.height = video.videoHeight;

        running = true;
        lastVideoTime = -1;

        startButton.disabled = true;
        stopButton.disabled = false;

        statusText.textContent = "Cámara activa. Muestra tu mano.";

        detectHands();
    } catch (error) {
        console.error(error);
        statusText.textContent =
        "No se pudo iniciar la cámara: " + error.message;
    }
    }

    // Detectar mano continuamente
    function detectHands() {
    if (!running) return;

    if (
        video.readyState >= 2 &&
        video.currentTime !== lastVideoTime
    ) {
        lastVideoTime = video.currentTime;

        const result = handLandmarker.detectForVideo(
        video,
        performance.now()
        );

        if (result.landmarks.length > 0) {
        processHand(result.landmarks[0]);
        } else {
        cursor.style.display = "none";
        // Limpiar el dibujo de la mano
        clearHandLandmarks();
        statusText.textContent = "No se detecta ninguna mano.";
        pinchActive = false;
        cursor.classList.remove("pinching");
        }
    }

    animationFrame = requestAnimationFrame(detectHands);
    }

    // Procesar los puntos de la mano
    function processHand(landmarks) {
        drawHandLandmarks(landmarks);
    // Centro aproximado de la palma:
    // muñeca + bases de los dedos
    const palmPoints = [
        landmarks[0],
        landmarks[5],
        landmarks[9],
        landmarks[13],
        landmarks[17]
    ];

    const palmX =
        palmPoints.reduce((sum, point) => sum + point.x, 0) /
        palmPoints.length;

    const palmY =
        palmPoints.reduce((sum, point) => sum + point.y, 0) /
        palmPoints.length;

    // Convertir coordenadas de cámara a pantalla.
    // Se invierte X para que coincida con el video espejado.
    const targetX = (1 - palmX) * window.innerWidth;
    const targetY = palmY * window.innerHeight;

    // Suavizar el movimiento para evitar saltos.
    cursorX += (targetX - cursorX) * 0.25;
    cursorY += (targetY - cursorY) * 0.25;

    cursor.style.left = cursorX + "px";
    cursor.style.top = cursorY + "px";
    cursor.style.display = "block";

    // Detectar gesto de pinza.
    // Punto 4: punta del pulgar.
    // Punto 8: punta del índice.
    const pinchDistance = distance(landmarks[4], landmarks[8]);

    // Normalizar según el ancho de la palma.
    const palmWidth = distance(landmarks[5], landmarks[17]) || 0.001;
    const pinchRatio = pinchDistance / palmWidth;

    // Umbrales diferentes para evitar clics repetidos.
    if (!pinchActive && pinchRatio < 0.35) {
        pinchActive = true;
        cursor.classList.add("pinching");
        clickAnimation();
    } else if (pinchActive && pinchRatio > 0.55) {
        pinchActive = false;
        cursor.classList.remove("pinching");
    }

    statusText.textContent = pinchActive
        ? "Pinza detectada."
        : "Mano detectada. Mueve la palma.";
    }

    // Hacer clic solamente en las animaciones del visor.
    function clickAnimation() {
    const now = performance.now();

    // Evitar múltiples clics seguidos.
    if (now - lastClickTime < 450) return;

    const target = document.elementFromPoint(cursorX, cursorY);

    // Solo permitir clic en los botones de la lista de animaciones.
    const animationButton = target?.closest(".anims button");

    if (animationButton) {
        animationButton.click();
        lastClickTime = now;
        statusText.textContent = "Animación seleccionada.";
    }
    }

    // Detener cámara
    
// Detener cámara
function stopVision() {
    clearHandLandmarks();

    running = false;

    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }

    video.srcObject = null;

    cursor.style.display = "none";
    cursor.classList.remove("pinching");

    pinchActive = false;

    startButton.disabled = false;
    stopButton.disabled = true;

    statusText.textContent = "Cámara desactivada.";
}


// Dibujar los puntos y conexiones de la mano
function drawHandLandmarks(landmarks) {
    const width = landmarkCanvas.width;
    const height = landmarkCanvas.height;

    ctx.clearRect(0, 0, width, height);

    // Dibujar conexiones entre los puntos
    ctx.beginPath();
    ctx.strokeStyle = "#35E0B5";
    ctx.lineWidth = Math.max(2, width / 250);

    HAND_CONNECTIONS.forEach(([start, end]) => {
        const pointA = landmarks[start];
        const pointB = landmarks[end];

        ctx.moveTo(
            pointA.x * width,
            pointA.y * height
        );

        ctx.lineTo(
            pointB.x * width,
            pointB.y * height
        );
    });

    ctx.stroke();

    // Dibujar los 21 puntos
    landmarks.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;

        ctx.beginPath();
        ctx.arc(
            x,
            y,
            Math.max(3, width / 100),
            0,
            Math.PI * 2
        );

        ctx.fillStyle = "#FFB347";
        ctx.fill();

        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Numeración de los landmarks
        ctx.font = `${Math.max(9, width / 55)}px Arial`;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(index, x + 7, y - 5);
    });
}

// Eventos
startButton.addEventListener("click", startVision);
stopButton.addEventListener("click", stopVision);

// Limpiar la cámara si se abandona la página.
window.addEventListener("pagehide", stopVision);
