import addOnUISdk from "https://new.express.adobe.com/static/add-on-sdk/sdk.js";

let initialized = false;
const state = {
    image: null,
    imageName: "",
    maskImage: null,
    maskName: "",
    imageScale: 1,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    maskSize: 0.8,
    feather: 0,
    opacity: 1,
    invert: false,
    showImage: false,
    dragging: false,
    lastPointer: null,
    activePointers: new Map(),
    pinchStart: null,
};

/** Dimmed full image under the masked layer when “Show image” is on. */
const OUTSIDE_MASK_DIM_OPACITY = 0.28;

const clearMask = () => {
    state.maskImage = null;
    state.maskName = "";
};

const initialize = () => {
    if (initialized) return;
    initialized = true;

    const canvas = document.getElementById("previewCanvas");
    const controls = getControls();
    const render = () => renderPreview(canvas);

    setupCanvas(canvas, render);
    setupControls(controls, render);
    resizeCanvas(canvas, render);
    window.addEventListener("resize", () => resizeCanvas(canvas, render));
    refreshStatus();
    render();
};

addOnUISdk.ready.then(initialize).catch(initialize);

// Keeps the panel testable when opened directly from the local dev server.
window.setTimeout(initialize, 800);

const unsupportedAttachmentMessage = (file) => {
    const name = file?.name || "This file";
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot + 1).trim() : "";
    if (ext) {
        return `${ext.toUpperCase()} is not supported.`;
    }
    return `${name} is not supported.`;
};

const getControls = () => ({
    imageInput: document.getElementById("imageInput"),
    maskInput: document.getElementById("maskInput"),
    clearMaskBtn: document.getElementById("clearCanvasMaskBtn"),
    addToPageBtn: document.getElementById("addToPageBtn"),
    clearImageBtn: document.getElementById("clearImageBtn"),
    rotation: document.getElementById("rotation"),
    rotationNum: document.getElementById("rotationNum"),
    maskSize: document.getElementById("maskSize"),
    maskSizeNum: document.getElementById("maskSizeNum"),
    feather: document.getElementById("feather"),
    featherNum: document.getElementById("featherNum"),
    invert: document.getElementById("invert"),
    showImage: document.getElementById("showImage"),
    resetBtn: document.getElementById("resetBtn"),
});

const setupControls = (controls, render) => {
    controls.imageInput.addEventListener("change", async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        state.image = await loadImage(URL.createObjectURL(file));
        state.imageName = file.name;
        resetTransform();
        refreshStatus();
        render();
    });

    controls.maskInput.addEventListener("change", async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        try {
            state.maskImage = await loadImage(url);
            state.maskName = file.name;
            refreshStatus();
            render();
        } catch {
            setError("Could not load that mask image.");
        } finally {
            URL.revokeObjectURL(url);
        }
    });

    controls.clearMaskBtn?.addEventListener("click", () => {
        clearMask();
        if (controls.maskInput) controls.maskInput.value = "";
        refreshStatus();
        render();
    });

    controls.addToPageBtn.addEventListener("click", () => addToPage());

    controls.clearImageBtn.addEventListener("click", () => {
        state.image = null;
        state.imageName = "";
        resetTransform();
        controls.imageInput.value = "";
        clearMask();
        if (controls.maskInput) controls.maskInput.value = "";
        refreshStatus();
        render();
    });
    const bindPair = (range, number, parseValue, write) => {
        const sync = (raw) => {
            const value = parseValue(raw);
            range.value = String(value.range);
            number.value = String(value.display);
            write(value.state);
            render();
        };
        range.addEventListener("input", () => sync(range.value));
        number.addEventListener("input", () => sync(number.value));
        number.addEventListener("change", () => sync(number.value));
    };

    bindPair(
        controls.rotation,
        controls.rotationNum,
        (raw) => {
            const value = clamp(Math.round(Number(raw) || 0), -180, 180);
            return { range: value, display: value, state: value };
        },
        (value) => { state.rotation = value; }
    );

    bindPair(
        controls.maskSize,
        controls.maskSizeNum,
        (raw) => {
            const value = clamp(Math.round(Number(raw) || 0), 20, 120);
            return { range: value, display: value, state: value / 100 };
        },
        (value) => { state.maskSize = value; }
    );

    bindPair(
        controls.feather,
        controls.featherNum,
        (raw) => {
            const value = clamp(Math.round(Number(raw) || 0), 0, 40);
            return { range: value, display: value, state: value };
        },
        (value) => { state.feather = value; }
    );

    controls.invert.addEventListener("change", () => update("invert", controls.invert.checked, render));
    controls.showImage?.addEventListener("change", () => update("showImage", controls.showImage.checked, render));

    const infoDialog = document.getElementById("infoDialog");
    const infoBtn = document.getElementById("infoBtn");
    const infoDialogClose = document.getElementById("infoDialogClose");
    infoBtn?.addEventListener("click", () => infoDialog?.showModal());
    infoDialogClose?.addEventListener("click", () => infoDialog?.close());
    infoDialog?.addEventListener("click", (event) => {
        if (event.target === infoDialog) infoDialog.close();
    });

    controls.resetBtn.addEventListener("click", () => {
        resetTransform();
        state.maskSize = 0.8;
        state.feather = 0;
        state.opacity = 1;
        state.invert = false;
        state.showImage = false;
        clearMask();
        if (controls.maskInput) controls.maskInput.value = "";
        controls.rotation.value = "0";
        controls.rotationNum.value = "0";
        controls.maskSize.value = "80";
        controls.maskSizeNum.value = "80";
        controls.feather.value = "0";
        controls.featherNum.value = "0";
        controls.invert.checked = false;
        controls.showImage.checked = false;
        refreshStatus();
        render();
    });
};

const setupCanvas = (canvas, render) => {
    canvas.addEventListener("pointerdown", (event) => {
        if (!state.image) return;
        const pointer = getPointer(canvas, event);
        state.activePointers.set(event.pointerId, pointer);
        if (state.activePointers.size === 2) {
            state.dragging = false;
            state.pinchStart = getPinchState();
        } else {
            state.dragging = true;
            state.lastPointer = pointer;
        }
        canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointermove", (event) => {
        const pointer = getPointer(canvas, event);
        if (state.activePointers.has(event.pointerId)) {
            state.activePointers.set(event.pointerId, pointer);
        }

        if (state.activePointers.size === 2 && state.pinchStart) {
            const currentPinch = getPinchState();
            const zoomFactor = currentPinch.distance / state.pinchStart.distance;
            zoomImageAt(currentPinch.center, state.pinchStart.scale * zoomFactor);
            render();
            return;
        }

        if (!state.dragging || !state.lastPointer) return;
        state.offsetX += pointer.x - state.lastPointer.x;
        state.offsetY += pointer.y - state.lastPointer.y;
        state.lastPointer = pointer;
        render();
    });

    canvas.addEventListener("wheel", (event) => {
        if (!state.image) return;
        event.preventDefault();
        const zoomFactor = Math.exp(-event.deltaY * 0.0015);
        zoomImageAt(getPointer(canvas, event), state.imageScale * zoomFactor);
        render();
    }, { passive: false });

    const endPointer = (event) => {
        state.activePointers.delete(event.pointerId);
        state.pinchStart = null;
        state.dragging = false;
        state.lastPointer = null;
        if (state.activePointers.size === 1) {
            state.dragging = true;
            state.lastPointer = [...state.activePointers.values()][0];
        }
    };
    window.addEventListener("pointerup", endPointer);
    window.addEventListener("pointercancel", endPointer);
};

const getPinchState = () => {
    const [first, second] = [...state.activePointers.values()];
    return {
        center: {
            x: (first.x + second.x) / 2,
            y: (first.y + second.y) / 2,
        },
        distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
        scale: state.imageScale,
    };
};

const zoomImageAt = (point, targetScale) => {
    const canvas = document.getElementById("previewCanvas");
    const rect = canvas.getBoundingClientRect();
    const center = { x: rect.width / 2, y: rect.height / 2 };
    const previousScale = state.imageScale;
    const nextScale = clamp(targetScale, 0.2, 5);
    const ratio = nextScale / previousScale;

    state.offsetX = point.x - center.x - (point.x - center.x - state.offsetX) * ratio;
    state.offsetY = point.y - center.y - (point.y - center.y - state.offsetY) * ratio;
    state.imageScale = nextScale;
};

const resizeCanvas = (canvas, render) => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    render();
};

const renderPreview = (canvas, exportScale = 1) => {
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    if (!state.image) {
        drawEmptyState(ctx, width, height);
        return;
    }

    const mask = createMaskCanvas(width, height, exportScale);
    const imageLayer = document.createElement("canvas");
    imageLayer.width = width;
    imageLayer.height = height;
    drawImageLayer(imageLayer.getContext("2d"), width, height, exportScale);

    ctx.save();
    if (state.showImage) {
        const imageFull = document.createElement("canvas");
        imageFull.width = width;
        imageFull.height = height;
        drawImageLayer(imageFull.getContext("2d"), width, height, exportScale);
        ctx.globalAlpha = state.opacity * OUTSIDE_MASK_DIM_OPACITY;
        ctx.drawImage(imageFull, 0, 0);
    }
    ctx.globalAlpha = state.opacity;
    if (state.invert) {
        const inverted = document.createElement("canvas");
        inverted.width = width;
        inverted.height = height;
        const invCtx = inverted.getContext("2d");
        invCtx.fillStyle = "#fff";
        invCtx.fillRect(0, 0, width, height);
        invCtx.globalCompositeOperation = "destination-out";
        invCtx.drawImage(mask, 0, 0);
        mask.getContext("2d").clearRect(0, 0, width, height);
        mask.getContext("2d").drawImage(inverted, 0, 0);
    }
    imageLayer.getContext("2d").globalCompositeOperation = "destination-in";
    imageLayer.getContext("2d").drawImage(mask, 0, 0);
    ctx.drawImage(imageLayer, 0, 0);
    ctx.restore();
};

const drawImageLayer = (ctx, width, height, exportScale) => {
    const baseScale = Math.max(width / state.image.width, height / state.image.height);
    const scale = baseScale * state.imageScale;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(width / 2 + state.offsetX * exportScale, height / 2 + state.offsetY * exportScale);
    ctx.rotate((state.rotation * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(state.image, -state.image.width / 2, -state.image.height / 2);
    ctx.restore();
};

const createMaskCanvas = (width, height, exportScale) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.filter = state.feather ? `blur(${state.feather * exportScale}px)` : "none";
    if (state.maskImage) {
        drawCustomMask(ctx, width, height);
    } else {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
    return canvas;
};

const drawCustomMask = (ctx, width, height) => {
    const bounds = getCustomMaskBounds(width, height);
    ctx.drawImage(state.maskImage, bounds.x, bounds.y, bounds.width, bounds.height);
};

const getCustomMaskBounds = (width, height) => {
    const size = Math.min(width, height) * state.maskSize;
    const aspect = state.maskImage.width / state.maskImage.height || 1;
    const maskWidth = aspect >= 1 ? size : size * aspect;
    const maskHeight = aspect >= 1 ? size / aspect : size;
    return {
        x: (width - maskWidth) / 2,
        y: (height - maskHeight) / 2,
        width: maskWidth,
        height: maskHeight,
    };
};

const drawEmptyState = (ctx, width, height) => {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.roundRect(width * 0.18, height * 0.18, width * 0.64, height * 0.64, 24);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.textAlign = "center";
    ctx.font = `${Math.max(14, width * 0.045)}px system-ui, sans-serif`;
    ctx.fillText("Upload an image", width / 2, height / 2 - 8);
    ctx.fillStyle = "rgba(255,255,255,0.42)";
    ctx.font = `${Math.max(11, width * 0.032)}px system-ui, sans-serif`;
    ctx.fillText("Then drag to position it", width / 2, height / 2 + 20);
    ctx.restore();
};

const addToPage = async () => {
    if (!state.image) {
        setError("Upload an image first.");
        return;
    }
    if (!state.maskImage) {
        setError("Upload a mask image first.");
        return;
    }

    const blob = await renderMaskedBlob();
    const documentApi = addOnUISdk?.app?.document;
    if (documentApi?.addImage) {
        await documentApi.addImage(blob);
        refreshStatus();
        return;
    }

    downloadBlob(blob);
    refreshStatus();
};

const renderMaskedBlob = () => new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1600;
    renderPreview(canvas, canvas.width / document.getElementById("previewCanvas").width);
    canvas.toBlob(resolve, "image/png");
});

const downloadBlob = (blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mask-master-export.png";
    link.click();
    URL.revokeObjectURL(url);
};

const loadImage = (src) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
});

const resetTransform = () => {
    state.imageScale = 1;
    state.rotation = 0;
    state.offsetX = 0;
    state.offsetY = 0;
    document.getElementById("rotation").value = "0";
};

const update = (key, value, render) => {
    state[key] = value;
    render();
};

const getPointer = (canvas, event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const setStatus = (message, { isError = false } = {}) => {
    const node = document.getElementById("status");
    node.textContent = message;
    node.classList.toggle("status-error", isError);
    node.classList.toggle("status-hidden", !message);
};

const refreshStatus = () => {
    const addBtn = document.getElementById("addToPageBtn");
    if (addBtn) {
        addBtn.disabled = !state.image || !state.maskImage;
    }
    const clearMaskBtn = document.getElementById("clearCanvasMaskBtn");
    if (clearMaskBtn) {
        clearMaskBtn.disabled = !state.maskImage;
    }
    const clearBtn = document.getElementById("clearImageBtn");
    if (clearBtn) {
        clearBtn.classList.toggle("visible", Boolean(state.image));
    }
    if (!state.image) {
        setStatus("Upload an image, then drag to position and scroll to zoom.");
        return;
    }
    if (!state.maskImage) {
        setStatus("Upload a mask image (PNG with transparency works best).");
        return;
    }
    setStatus("");
};

const setError = (message) => setStatus(message, { isError: true });
