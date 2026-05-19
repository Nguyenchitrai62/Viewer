// pdf_handling.js

// --- New PDF Handling Functions ---

function getPdfSourceKey(file = currentPdfFile) {
    if (!file) return null;
    return `${file.name}:${file.size}:${file.lastModified}`;
}

function revokeCurrentPdfDocumentUrl() {
    if (!currentPdfDocumentObjectUrl) return;
    URL.revokeObjectURL(currentPdfDocumentObjectUrl);
    currentPdfDocumentObjectUrl = null;
}

async function releaseCurrentPdfResources() {
    cancelCurrentPdfRasterPreviewWork();
    const pdfToDestroy = currentPdfDocument;
    currentPdfDocument = null;
    currentPdfDocumentPromise = null;
    currentPdfDocumentSourceKey = null;
    pdfRasterPreviewPages = {};
    pdfRasterPreviewLoadingPages = {};
    cachedPageImage = null;
    cachedPageImageLoading = false;
    cachedPageImagePageNum = null;
    cachedPageImageScale = null;
    cachedPageImagePromise = null;
    cachedPageImageRequestedPageNum = null;

    if (pdfToDestroy) {
        try {
            await pdfToDestroy.destroy();
        } catch (error) {
            console.warn('PDF destroy error:', error);
        }
    }

    revokeCurrentPdfDocumentUrl();
}

async function ensureCurrentPdfDocument() {
    if (!currentPdfFile) return null;

    const sourceKey = getPdfSourceKey(currentPdfFile);
    if (currentPdfDocument && currentPdfDocumentSourceKey === sourceKey) {
        return currentPdfDocument;
    }
    if (currentPdfDocumentPromise && currentPdfDocumentSourceKey === sourceKey) {
        return currentPdfDocumentPromise;
    }

    if (currentPdfDocument && currentPdfDocumentSourceKey !== sourceKey) {
        try {
            await currentPdfDocument.destroy();
        } catch (error) {
            console.warn('PDF destroy error:', error);
        }
        currentPdfDocument = null;
    }

    revokeCurrentPdfDocumentUrl();
    currentPdfDocumentSourceKey = sourceKey;
    pdfRasterPreviewPages = {};
    pdfRasterPreviewLoadingPages = {};
    currentPdfDocumentObjectUrl = URL.createObjectURL(currentPdfFile);
    const pdfObjectUrl = currentPdfDocumentObjectUrl;

    currentPdfDocumentPromise = pdfjsLib.getDocument({
        ...window.PDFJS_DOCUMENT_OPTIONS,
        url: pdfObjectUrl,
    }).promise
        .then(pdfDocument => {
            if (currentPdfDocumentSourceKey !== sourceKey) {
                try {
                    pdfDocument.destroy();
                } catch (error) {
                    console.warn('Discard stale PDF document error:', error);
                }
                URL.revokeObjectURL(pdfObjectUrl);
                throw new Error('Discarded stale PDF document.');
            }
            currentPdfDocument = pdfDocument;
            return pdfDocument;
        })
        .catch(error => {
            if (currentPdfDocumentSourceKey === sourceKey) {
                currentPdfDocument = null;
                currentPdfDocumentPromise = null;
                revokeCurrentPdfDocumentUrl();
            }
            throw error;
        });

    return currentPdfDocumentPromise;
}

function beginPriorityPageLoad() {
    activePageLoadCount += 1;
    if (canvasContainer) {
        canvasContainer.style.pointerEvents = 'none';
    }
}

function endPriorityPageLoad() {
    activePageLoadCount = Math.max(0, activePageLoadCount - 1);
    if (canvasContainer && activePageLoadCount === 0) {
        canvasContainer.style.pointerEvents = '';
    }
}

function hasCachedPageImage(pageNum = currentPageNum) {
    return Boolean(
        cachedPageImage &&
        cachedPageImage.width > 0 &&
        cachedPageImage.height > 0 &&
        cachedPageImagePageNum === pageNum &&
        Number.isFinite(cachedPageImageScale) &&
        cachedPageImageScale > 0
    );
}

function getCurrentPdfRasterPreview(pageNum = currentPageNum) {
    if (!currentPdfFile || !pageNum || !hasCachedPageImage(pageNum)) return null;

    const scale = cachedPageImageScale || CONFIG.PDF_PAGE_CACHE_SCALE || 3;
    const width = cachedPageImage.width / scale;
    const height = cachedPageImage.height / scale;

    return {
        canvas: cachedPageImage,
        bounds: {
            minX: 0,
            minY: 0,
            maxX: width,
            maxY: height,
            width,
            height
        },
        scale,
        kind: 'pdf',
        pageNum
    };
}

function isCurrentPdfRasterPreviewPending(pageNum = currentPageNum) {
    if (!currentPdfFile || !pageNum) return false;
    if (hasCachedPageImage(pageNum)) return false;
    return Boolean(cachedPageImageLoading || cachedPageImageRequestedPageNum === pageNum);
}

function cancelCurrentPdfRasterPreviewWork() {
    cachedPageImageTaskToken += 1;
    cachedPageImage = null;
    cachedPageImagePageNum = null;
    cachedPageImageScale = null;
    cachedPageImageLoading = false;
    cachedPageImagePromise = null;
    cachedPageImageRequestedPageNum = null;
    if (cachedPageImageRenderTask) {
        try {
            cachedPageImageRenderTask.cancel();
        } catch (error) {
            console.warn('PDF raster preview cancel error:', error);
        }
        cachedPageImageRenderTask = null;
    }
}

function cancelCurrentPageOptimizationWork() {
    if (typeof discardShapeRasterCache === 'function') {
        discardShapeRasterCache({ preserveDisplayedPreview: true });
    } else if (typeof cancelPendingVectorRender === 'function') {
        cancelPendingVectorRender();
    }
    if (typeof invalidateFindPopupPageCache === 'function') {
        invalidateFindPopupPageCache();
    }
    if (typeof cancelSnapPointIndexBuild === 'function') {
        cancelSnapPointIndexBuild();
    }
    if (typeof cancelCurrentMainLayerClassificationWork === 'function') {
        cancelCurrentMainLayerClassificationWork();
    }
    cancelCurrentPdfRasterPreviewWork();
}

async function buildCurrentPdfRasterPreview(pageNum = currentPageNum) {
    if (!currentPdfFile || !pageNum) return null;
    if (hasCachedPageImage(pageNum)) {
        return getCurrentPdfRasterPreview(pageNum);
    }

    await preRenderPageImage(pageNum);
    return getCurrentPdfRasterPreview(pageNum);
}

function scheduleCurrentPdfRasterPreview(pageNum = currentPageNum) {
    if (!currentPdfFile || !pageNum) return;
    if (hasCachedPageImage(pageNum)) return;

    buildCurrentPdfRasterPreview(pageNum).catch(error => {
        console.warn(`PDF raster preview schedule for page ${pageNum} failed:`, error);
    });
}

async function renderPdfPreview(file, pageNum) {
    const pdfPreview = document.getElementById('pdf-preview');
    if (!pdfPreview) {
        return;
    }
    pdfPreview.innerHTML = '<div style="display: flex; justify-content: center; align-items: center; height: 100%;"><div>Loading PDF preview...</div></div>';
    pdfPreview.style.display = 'block';

    // Hide drop zone while showing preview
    dropZone.classList.add('hidden');

    let pdf = null;
    let page = null;
    try {
        pdf = await ensureCurrentPdfDocument();
        page = await pdf.getPage(pageNum);

        const viewport = page.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        // Scale to fit container
        const containerRect = canvasContainer.getBoundingClientRect();
        const fitScale = Math.min(containerRect.width / viewport.width, containerRect.height / viewport.height) * 0.9;
        const deviceScale = Math.max(window.devicePixelRatio || 1, 1);
        const renderScale = fitScale * deviceScale;
        const scaledViewport = page.getViewport({ scale: renderScale });

        canvas.height = Math.max(1, Math.ceil(scaledViewport.height));
        canvas.width = Math.max(1, Math.ceil(scaledViewport.width));
        canvas.style.width = `${Math.max(1, Math.round(viewport.width * fitScale))}px`;
        canvas.style.height = `${Math.max(1, Math.round(viewport.height * fitScale))}px`;

        const renderContext = {
            canvasContext: context,
            viewport: scaledViewport
        };

        await page.render(renderContext).promise;

        pdfPreview.innerHTML = '';
        pdfPreview.appendChild(canvas);

        // Center the canvas
        canvas.style.position = 'absolute';
        canvas.style.top = '50%';
        canvas.style.left = '50%';
        canvas.style.transform = 'translate(-50%, -50%)';

    } catch (error) {
        pdfPreview.innerHTML = '<div style="display: flex; justify-content: center; align-items: center; height: 100%;"><div>Error loading PDF preview</div></div>';
        console.error('Error rendering PDF preview:', error);
    } finally {
        if (page) {
            try { page.cleanup(); } catch (e) { console.warn('Page cleanup error:', e); }
        }
    }
}

// ============================================
// PRE-RENDER: Cache PDF page as image for VLM crop
// ============================================
async function preRenderPageImage(pageNum = currentPageNum) {
    if (!currentPdfFile || !pageNum) return null;
    if (hasCachedPageImage(pageNum)) return cachedPageImage;

    cachedPageImageRequestedPageNum = pageNum;
    if (cachedPageImagePromise) {
        return cachedPageImagePromise;
    }

    cachedPageImageLoading = true;
    const buildPromise = (async () => {
        const taskToken = cachedPageImageTaskToken;
        let latestCanvas = null;

        while (taskToken === cachedPageImageTaskToken && cachedPageImageRequestedPageNum) {
            const targetPage = cachedPageImageRequestedPageNum;
            cachedPageImageRequestedPageNum = null;
            console.time(`Pre-render page ${targetPage} image`);

            let page = null;
            let renderTask = null;
            try {
                const pdf = await ensureCurrentPdfDocument();
                if (taskToken !== cachedPageImageTaskToken) {
                    return latestCanvas;
                }
                page = await pdf.getPage(targetPage);
                if (taskToken !== cachedPageImageTaskToken) {
                    return latestCanvas;
                }

                const scale = CONFIG.PDF_PAGE_CACHE_SCALE || 3;
                const viewport = page.getViewport({ scale });

                const offCanvas = document.createElement('canvas');
                offCanvas.width = Math.max(1, Math.ceil(viewport.width));
                offCanvas.height = Math.max(1, Math.ceil(viewport.height));
                const offCtx = offCanvas.getContext('2d');
                if (!offCtx) continue;

                renderTask = page.render({
                    canvasContext: offCtx,
                    viewport
                });
                cachedPageImageRenderTask = renderTask;

                await renderTask.promise;

                if (taskToken !== cachedPageImageTaskToken) {
                    return latestCanvas;
                }

                if (currentPageNum === targetPage) {
                    cachedPageImage = offCanvas;
                    cachedPageImagePageNum = targetPage;
                    cachedPageImageScale = scale;
                    latestCanvas = offCanvas;
                    if (typeof scheduleDraw === 'function') {
                        scheduleDraw();
                    }
                    console.log(`Pre-rendered page ${targetPage} image x${scale}: ${offCanvas.width}x${offCanvas.height}`);
                } else {
                    console.log(`Pre-render page ${targetPage} discarded (user switched to page ${currentPageNum})`);
                }
            } catch (error) {
                if (taskToken !== cachedPageImageTaskToken || error?.name === 'RenderingCancelledException') {
                    continue;
                }
                console.warn(`Pre-render page ${targetPage} failed:`, error);
            } finally {
                if (cachedPageImageRenderTask === renderTask) {
                    cachedPageImageRenderTask = null;
                }
                if (page) {
                    try { page.cleanup(); } catch (e) {}
                }
                console.timeEnd(`Pre-render page ${targetPage} image`);
            }
        }

        return latestCanvas;
    })().finally(() => {
        if (cachedPageImagePromise === buildPromise) {
            cachedPageImageLoading = false;
            cachedPageImagePromise = null;
        }
    });

    cachedPageImagePromise = buildPromise;

    return cachedPageImagePromise;
}

function hidePdfPreview() {
    const pdfPreview = document.getElementById('pdf-preview');
    if (!pdfPreview) {
        return;
    }
    pdfPreview.style.display = 'none';
    pdfPreview.innerHTML = '';
}

function getPdfUploadSessionKey(file) {
    if (!file) return null;
    return `${file.name}:${file.size}:${file.lastModified}`;
}

function clearCurrentUploadController(controller = currentUploadController) {
    if (currentUploadController === controller) {
        currentUploadController = null;
        currentUploadControllerSourceKey = null;
    }
}

function clearCurrentPdfUploadSession(file = null) {
    if (!currentPdfUploadSession) {
        return;
    }

    if (!file) {
        currentPdfUploadSession = null;
        return;
    }

    const sourceKey = getPdfUploadSessionKey(file);
    if (currentPdfUploadSession.sourceKey === sourceKey) {
        currentPdfUploadSession = null;
    }
}

function invalidatePdfUploadSessionForResponse(response, file) {
    const status = Number(response?.status || 0);
    if (status === 404 || status === 409 || status === 410) {
        clearCurrentPdfUploadSession(file);
    }
}

function closeCurrentUploadSocket(socket = currentUploadSocket) {
    if (!socket) return;
    if (currentUploadSocket === socket) {
        currentUploadSocket = null;
    }
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
    }
}

function getApiWebSocketUrl(pathname) {
    const baseUrl = new URL(ENV.API_BASE_URL, window.location.href);
    baseUrl.protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = baseUrl.pathname.endsWith('/') ? baseUrl.pathname.slice(0, -1) : baseUrl.pathname;
    return `${baseUrl.origin}${basePath}${pathname}`;
}

function waitForWebSocketOpen(socket, signal = null) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            socket.removeEventListener('open', handleOpen);
            socket.removeEventListener('error', handleError);
            socket.removeEventListener('close', handleClose);
            signal?.removeEventListener('abort', handleAbort);
        };

        const handleOpen = () => {
            cleanup();
            resolve();
        };
        const handleError = () => {
            cleanup();
            reject(new Error('WebSocket upload connection failed.'));
        };
        const handleClose = () => {
            cleanup();
            reject(new Error('WebSocket upload connection closed before opening.'));
        };
        const handleAbort = () => {
            cleanup();
            try {
                socket.close();
            } catch (error) {
                console.warn('WebSocket close on abort failed:', error);
            }
            reject(new DOMException('Upload aborted.', 'AbortError'));
        };

        socket.addEventListener('open', handleOpen, { once: true });
        socket.addEventListener('error', handleError, { once: true });
        socket.addEventListener('close', handleClose, { once: true });
        signal?.addEventListener('abort', handleAbort, { once: true });
    });
}

function waitForWebSocketMessage(socket, signal = null) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            socket.removeEventListener('message', handleMessage);
            socket.removeEventListener('error', handleError);
            socket.removeEventListener('close', handleClose);
            signal?.removeEventListener('abort', handleAbort);
        };

        const handleMessage = event => {
            cleanup();
            resolve(event);
        };
        const handleError = () => {
            cleanup();
            reject(new Error('WebSocket upload error.'));
        };
        const handleClose = () => {
            cleanup();
            reject(new Error('WebSocket upload connection closed unexpectedly.'));
        };
        const handleAbort = () => {
            cleanup();
            try {
                socket.close();
            } catch (error) {
                console.warn('WebSocket close on abort failed:', error);
            }
            reject(new DOMException('Upload aborted.', 'AbortError'));
        };

        socket.addEventListener('message', handleMessage, { once: true });
        socket.addEventListener('error', handleError, { once: true });
        socket.addEventListener('close', handleClose, { once: true });
        signal?.addEventListener('abort', handleAbort, { once: true });
    });
}

async function waitForWebSocketBufferedAmount(socket, maxBufferedAmount, signal = null) {
    while (socket.readyState === WebSocket.OPEN && socket.bufferedAmount > maxBufferedAmount) {
        if (signal?.aborted) {
            throw new DOMException('Upload aborted.', 'AbortError');
        }
        await new Promise(resolve => setTimeout(resolve, 20));
    }

    if (socket.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket upload connection closed during transfer.');
    }
}

async function createPdfUploadSession(file, signal = null) {
    const initFormData = new FormData();
    initFormData.append('filename', file.name);
    initFormData.append('file_size', String(file.size));
    initFormData.append('last_modified', String(file.lastModified || 0));

    const initResponse = await fetch(`${ENV.API_BASE_URL}/upload-sessions`, {
        method: 'POST',
        body: initFormData,
        signal,
    });
    if (!initResponse.ok) {
        throw new Error(await parseHttpErrorResponse(initResponse, `Failed to create upload session (${initResponse.status}).`));
    }

    return initResponse.json();
}

async function ensurePdfUploadSessionViaWebSocket(file, signal = null) {
    const uploadStartedAt = performance.now();
    const initResult = await createPdfUploadSession(file, signal);
    const sessionId = initResult.session_id;
    const wsFrameSize = Number(CONFIG.PDF_UPLOAD_WS_FRAME_SIZE) || (8 * 1024 * 1024);
    const wsBufferLimit = Math.max(Number(CONFIG.PDF_UPLOAD_WS_BUFFER_LIMIT) || (32 * 1024 * 1024), wsFrameSize);
    const socket = new WebSocket(getApiWebSocketUrl(`/upload-sessions/${encodeURIComponent(sessionId)}/ws`));
    currentUploadSocket = socket;
    let frameCount = 0;

    try {
        await waitForWebSocketOpen(socket, signal);

        const readyEvent = await waitForWebSocketMessage(socket, signal);
        const readyPayload = JSON.parse(readyEvent.data);
        if (readyPayload?.type === 'error') {
            throw new Error(readyPayload.message || 'WebSocket upload init failed.');
        }
        if (readyPayload?.type !== 'ready') {
            throw new Error('Unexpected WebSocket upload handshake response.');
        }

        for (let offset = 0; offset < file.size; offset += wsFrameSize) {
            if (signal?.aborted) {
                throw new DOMException('Upload aborted.', 'AbortError');
            }

            const end = Math.min(file.size, offset + wsFrameSize);
            socket.send(file.slice(offset, end));
            frameCount += 1;
            await waitForWebSocketBufferedAmount(socket, wsBufferLimit, signal);

            showCanvasStatusOverlay(
                'Uploading PDF...',
                `WebSocket stream · ${formatBytes(end)} / ${formatBytes(file.size)}`,
                'info'
            );
            await yieldToBrowser();
        }

        socket.send(JSON.stringify({
            action: 'complete',
            filename: file.name,
            file_size: file.size,
        }));

        const completeEvent = await waitForWebSocketMessage(socket, signal);
        const completePayload = JSON.parse(completeEvent.data);
        if (completePayload?.type === 'error') {
            throw new Error(completePayload.message || 'WebSocket upload failed.');
        }
        if (completePayload?.type !== 'complete') {
            throw new Error('Unexpected WebSocket upload completion response.');
        }

        const uploadSeconds = Math.max((performance.now() - uploadStartedAt) / 1000, 0.001);
        const uploadMbps = (file.size / 1024 / 1024) / uploadSeconds;
        console.info(
            `WS upload completed in ${uploadSeconds.toFixed(2)}s ` +
            `(${uploadMbps.toFixed(2)} MB/s, ${frameCount} frames).`,
            completePayload,
        );

        currentPdfUploadSession = {
            sessionId,
            sourceKey: getPdfUploadSessionKey(file),
            fileSize: file.size,
            transport: 'websocket',
        };
        return currentPdfUploadSession;
    } finally {
        closeCurrentUploadSocket(socket);
    }
}

async function ensurePdfUploadSession(file, { signal = null, force = false } = {}) {
    if (!file) {
        throw new Error('No PDF file available for upload.');
    }

    const sessionKey = getPdfUploadSessionKey(file);
    if (!force && currentPdfUploadSession?.sessionId && currentPdfUploadSession.sourceKey === sessionKey) {
        return currentPdfUploadSession;
    }

    if (!force && currentPdfUploadPromise && currentPdfUploadPromiseSourceKey === sessionKey) {
        return currentPdfUploadPromise;
    }

    currentPdfUploadPromiseSourceKey = sessionKey;
    currentPdfUploadPromise = ensurePdfUploadSessionViaWebSocket(file, signal)
        .finally(() => {
            if (currentPdfUploadPromiseSourceKey === sessionKey) {
                currentPdfUploadPromise = null;
                currentPdfUploadPromiseSourceKey = null;
            }
        });
    return currentPdfUploadPromise;
}

async function buildPdfRequestFormData(file, pageNum = null) {
    const formData = new FormData();
    if (pageNum !== null && pageNum !== undefined) {
        formData.append('page_num', String(pageNum));
    }

    if (!file) {
        return formData;
    }

    const sessionKey = getPdfUploadSessionKey(file);
    if (currentUploadController && currentUploadControllerSourceKey !== sessionKey) {
        currentUploadController.abort();
    }

    const controller = currentUploadController || new AbortController();
    currentUploadController = controller;
    currentUploadControllerSourceKey = sessionKey;
    try {
        const session = await ensurePdfUploadSession(file, { signal: controller.signal });
        formData.append('upload_session_id', session.sessionId);
        return formData;
    } finally {
        clearCurrentUploadController(controller);
    }
}

function buildCacheOnlyPdfRequestFormData(file, pageNum = null) {
    const formData = new FormData();
    if (pageNum !== null && pageNum !== undefined) {
        formData.append('page_num', String(pageNum));
    }
    formData.append('pdf_name', file?.name || '');
    formData.append('cache_only', 'true');
    return formData;
}

async function openCachedProcessAllPagesResponse(file, signal = null) {
    if (!file?.name) {
        return null;
    }

    try {
        const response = await fetch(`${ENV.API_BASE_URL}/process_all_pages`, {
            method: 'POST',
            body: buildCacheOnlyPdfRequestFormData(file),
            signal,
        });

        if (response.ok) {
            console.info(`Using split-countfire DB cache for ${file.name}; skipping PDF upload.`);
            return response;
        }

        const message = await parseHttpErrorResponse(
            response,
            `No complete cached page gzip found for ${file.name}.`
        );
        console.info(`Split-countfire cache probe miss for ${file.name}: ${message}`);
        return null;
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw error;
        }
        console.warn(`Split-countfire cache probe failed for ${file.name}; falling back to upload.`, error);
        return null;
    }
}

async function openCachedProcessPageResponse(file, pageNum, signal = null) {
    if (!file?.name || !pageNum) {
        return null;
    }

    try {
        const response = await fetch(`${ENV.API_BASE_URL}/process_page`, {
            method: 'POST',
            body: buildCacheOnlyPdfRequestFormData(file, pageNum),
            signal,
        });

        if (response.ok) {
            console.info(`Using split-countfire DB cache for ${file.name} page ${pageNum}; skipping PDF upload.`);
            return response;
        }

        const message = await parseHttpErrorResponse(
            response,
            `No cached page gzip found for ${file.name} page ${pageNum}.`
        );
        console.info(`Split-countfire page cache miss for ${file.name} page ${pageNum}: ${message}`);
        return null;
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw error;
        }
        console.warn(`Split-countfire page cache probe failed for ${file.name} page ${pageNum}; falling back to upload.`, error);
        return null;
    }
}

function parseSseEventBlock(block) {
    let eventType = '';
    let dataStart = -1;
    let dataEnd = -1;
    let dataText = '';
    let dataLineCount = 0;
    let lineStart = 0;

    while (lineStart <= block.length) {
        let lineEnd = block.indexOf('\n', lineStart);
        if (lineEnd < 0) lineEnd = block.length;
        let valueEnd = lineEnd;
        if (valueEnd > lineStart && block.charCodeAt(valueEnd - 1) === 13) {
            valueEnd -= 1;
        }

        if (block.startsWith('event: ', lineStart)) {
            eventType = block.slice(lineStart + 7, valueEnd);
        } else if (block.startsWith('data: ', lineStart)) {
            const valueStart = lineStart + 6;
            dataLineCount += 1;
            if (dataLineCount === 1) {
                dataStart = valueStart;
                dataEnd = valueEnd;
            } else {
                if (dataLineCount === 2 && dataText === '' && dataStart >= 0) {
                    dataText = block.slice(dataStart, dataEnd);
                }
                dataText += `\n${block.slice(valueStart, valueEnd)}`;
            }
        }

        if (lineEnd >= block.length) break;
        lineStart = lineEnd + 1;
    }

    return { block, eventType, dataStart, dataEnd, dataText, dataLineCount };
}

function getSseEventDataText(event) {
    if (!event || event.dataStart < 0) return '';
    if (event.dataLineCount <= 1) {
        return event.block.slice(event.dataStart, event.dataEnd);
    }
    return event.dataText;
}

function findJsonFieldValueStart(text, start, end, fieldName) {
    const marker = `"${fieldName}":`;
    const markerIndex = text.indexOf(marker, start);
    if (markerIndex < 0 || markerIndex >= end) return -1;
    let valueStart = markerIndex + marker.length;
    while (valueStart < end) {
        const charCode = text.charCodeAt(valueStart);
        if (charCode !== 32 && charCode !== 9 && charCode !== 10 && charCode !== 13) break;
        valueStart += 1;
    }
    return valueStart < end ? valueStart : -1;
}

function readJsonNumberField(text, start, end, fieldName, fallback = 0) {
    const valueStart = findJsonFieldValueStart(text, start, end, fieldName);
    if (valueStart < 0) return fallback;
    let valueEnd = valueStart;
    while (valueEnd < end) {
        const char = text[valueEnd];
        if ((char >= '0' && char <= '9') || char === '-' || char === '+' || char === '.' || char === 'e' || char === 'E') {
            valueEnd += 1;
            continue;
        }
        break;
    }
    const value = Number(text.slice(valueStart, valueEnd));
    return Number.isFinite(value) ? value : fallback;
}

function readJsonBooleanField(text, start, end, fieldName, fallback = false) {
    const valueStart = findJsonFieldValueStart(text, start, end, fieldName);
    if (valueStart < 0) return fallback;
    if (valueStart + 4 <= end && text.startsWith('true', valueStart)) return true;
    if (valueStart + 5 <= end && text.startsWith('false', valueStart)) return false;
    return fallback;
}

function readJsonRawStringField(text, start, end, fieldName) {
    const valueStart = findJsonFieldValueStart(text, start, end, fieldName);
    if (valueStart < 0 || text.charCodeAt(valueStart) !== 34) return null;
    let valueEnd = valueStart + 1;
    while (valueEnd < end) {
        const charCode = text.charCodeAt(valueEnd);
        if (charCode === 34) {
            return text.slice(valueStart + 1, valueEnd);
        }
        if (charCode === 92) {
            return null;
        }
        valueEnd += 1;
    }
    return null;
}

function parseLargePageDataEvent(event) {
    const start = event?.dataStart ?? -1;
    const end = event?.dataEnd ?? -1;
    if (!event || start < 0 || end <= start || event.dataLineCount !== 1) {
        return JSON.parse(getSseEventDataText(event));
    }

    const gzipData = readJsonRawStringField(event.block, start, end, 'gzip_data');
    if (gzipData === null) {
        return JSON.parse(getSseEventDataText(event));
    }

    return {
        page_num: readJsonNumberField(event.block, start, end, 'page_num', 0),
        gzip_size: readJsonNumberField(event.block, start, end, 'gzip_size', getBase64DecodedByteLength(gzipData)),
        gzip_data: gzipData,
        time: readJsonNumberField(event.block, start, end, 'time', 0),
        cache_hit: readJsonBooleanField(event.block, start, end, 'cache_hit', false)
    };
}

function cancelCurrentBatchProcessing() {
    currentBatchTaskId += 1;
    pageLoadRequestId += 1;
    autoOpenReadyPage = false;
    waitingPageNum = null;
    currentThumbnailWarmupTaskId = 0;
    currentThumbnailWarmupSourceKey = null;
    hideCanvasStatusOverlay();
    clearCurrentPdfUploadSession();

    if (currentBatchAbortController) {
        currentBatchAbortController.abort();
        currentBatchAbortController = null;
    }

    if (currentUploadController) {
        currentUploadController.abort();
        currentUploadController = null;
        currentUploadControllerSourceKey = null;
    }

    currentPdfUploadPromise = null;
    currentPdfUploadPromiseSourceKey = null;

    if (currentUploadSocket) {
        closeCurrentUploadSocket(currentUploadSocket);
        currentUploadSocket = null;
    }
}

function updatePageProcessingSummary() {
    const summary = document.getElementById('page-processing-summary');
    const titleEl = document.getElementById('page-processing-summary-title');
    const subtitleEl = document.getElementById('page-processing-summary-subtitle');
    const totalPages = Object.keys(pageThumbnailRefs).length;

    if (!summary || !titleEl || !subtitleEl || totalPages === 0) {
        summary?.classList.remove('is-visible');
        return;
    }

    const states = Object.values(pdfPageProcessingState);
    const readyCount = states.filter(state => state.status === 'ready').length;
    const errorCount = states.filter(state => state.status === 'error').length;
    const pendingCount = Math.max(0, totalPages - readyCount - errorCount);

    summary.classList.add('is-visible');
    if (pendingCount > 0) {
        titleEl.textContent = `${readyCount}/${totalPages} pages ready`;
        subtitleEl.textContent = errorCount > 0
            ? `${pendingCount} pages processing, ${errorCount} pages failed.`
            : `${pendingCount} pages are still processing in the background.`;
        return;
    }

    if (errorCount > 0) {
        titleEl.textContent = `${readyCount}/${totalPages} pages ready`;
        subtitleEl.textContent = `${errorCount} pages failed to process.`;
        return;
    }

    titleEl.textContent = `All ${totalPages} pages ready`;
    subtitleEl.textContent = 'You can open any page immediately.';
}

function resetPdfPageProcessingState() {
    pdfPageProcessingState = {};
    pageThumbnailRefs = {};
    selectedThumbnailPageNum = null;
    waitingPageNum = null;
    autoOpenReadyPage = false;
    updatePageProcessingSummary();
}

function clearPdfPageSidebar() {
    currentThumbnailTaskId += 1;
    currentThumbnailWarmupTaskId = 0;
    currentThumbnailWarmupSourceKey = null;
    const thumbnailsContainer = document.getElementById('page-thumbnails');
    if (thumbnailsContainer) {
        thumbnailsContainer.innerHTML = '';
    }
    hideCanvasStatusOverlay();
    hidePdfPreview();
    clearCurrentPdfUploadSession(stagedPdfFile || currentPdfFile);
    stagedPdfFile = null;
    resetStagedPageGzipCache();
    resetPdfPageProcessingState();
}

function getPageSelectionContext() {
    if (stagedPdfFile) {
        return {
            file: stagedPdfFile,
            cache: stagedCachedPages,
            isStaged: true,
        };
    }

    return {
        file: currentPdfFile,
        cache: cachedPages,
        isStaged: false,
    };
}

async function promoteStagedPdfIfNeeded(file) {
    if (!file || stagedPdfFile !== file) {
        return;
    }

    if (currentPdfFile !== file && typeof releaseCurrentPdfResources === 'function') {
        await releaseCurrentPdfResources();
    }

    currentPdfFile = file;
    cachedPages = stagedCachedPages;

    if (typeof loadSymbolAnnotationDocumentSummary === 'function') {
        void loadSymbolAnnotationDocumentSummary({ silent: true }).catch(error => {
            console.warn('Failed to prefetch symbol label summary for active PDF:', error);
        });
    }
}

function getPageStatusLabel(status) {
    switch (status) {
        case 'ready':
            return 'Ready';
        case 'error':
            return 'Error';
        case 'queued':
            return 'Queued';
        default:
            return 'Processing';
    }
}

function setPageProcessingState(pageNum, status, { label = null, detail = '' } = {}) {
    pdfPageProcessingState[pageNum] = {
        ...(pdfPageProcessingState[pageNum] || {}),
        status,
        label: label || getPageStatusLabel(status),
        detail
    };

    const refs = pageThumbnailRefs[pageNum];
    if (refs?.element) {
        refs.element.classList.remove('is-processing', 'is-ready', 'is-error');
        const stateClass = status === 'ready'
            ? 'is-ready'
            : (status === 'error' ? 'is-error' : 'is-processing');
        refs.element.classList.add(stateClass);

        if (refs.badge) {
            refs.badge.textContent = pdfPageProcessingState[pageNum].label;
        }

        if (refs.preview && !refs.preview.querySelector('canvas, img')) {
            const placeholderMessage = detail || `Page ${pageNum}`;
            refs.preview.innerHTML = `<div class="page-thumbnail-placeholder">${placeholderMessage}</div>`;
        }
    }

    updatePageProcessingSummary();
}

function showPendingPageOverlay(pageNum, subtitle) {
    dropZone.classList.add('hidden');
    hidePdfPreview();
    showCanvasStatusOverlay(`Page ${pageNum} is loading`, subtitle, 'info');
}

function buildCacheOnlyPdfThumbnailFormData(file) {
    const formData = new FormData();
    formData.append('pdf_name', file?.name || '');
    formData.append('file_size', String(file?.size || 0));
    formData.append('last_modified', String(file?.lastModified || 0));
    formData.append('target_width', String(CONFIG.PDF_THUMBNAIL_TARGET_WIDTH || 180));
    formData.append('cache_only', 'true');
    return formData;
}

async function buildPdfThumbnailFormData(file, signal = null) {
    const formData = new FormData();
    formData.append('pdf_name', file?.name || '');
    formData.append('file_size', String(file?.size || 0));
    formData.append('last_modified', String(file?.lastModified || 0));
    formData.append('target_width', String(CONFIG.PDF_THUMBNAIL_TARGET_WIDTH || 180));
    const session = await ensurePdfUploadSession(file, { signal });
    formData.append('upload_session_id', session.sessionId);
    return formData;
}

async function openCachedPdfThumbnailsResponse(file, signal = null) {
    if (!file?.name) return null;
    try {
        const response = await fetch(`${ENV.API_BASE_URL}/pdf_thumbnails`, {
            method: 'POST',
            body: buildCacheOnlyPdfThumbnailFormData(file),
            signal,
        });
        if (response.ok) {
            console.info(`Using PDF thumbnail cache for ${file.name}; skipping thumbnail render.`);
            return response;
        }
        const message = await parseHttpErrorResponse(response, `No cached thumbnails found for ${file.name}.`);
        console.info(`PDF thumbnail cache miss for ${file.name}: ${message}`);
        return null;
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        console.warn(`PDF thumbnail cache probe failed for ${file.name}; falling back to backend render.`, error);
        return null;
    }
}

function ensurePageThumbnailPlaceholders(totalPages) {
    const thumbnailsContainer = document.getElementById('page-thumbnails');
    if (!thumbnailsContainer || totalPages < 1) return;

    const currentCount = Object.keys(pageThumbnailRefs).length;
    if (currentCount === totalPages) return;

    thumbnailsContainer.innerHTML = '';
    pageThumbnailRefs = {};

    for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
        const div = document.createElement('div');
        div.className = 'page-thumbnail';
        div.dataset.page = String(pageNum);

        const preview = document.createElement('div');
        preview.className = 'page-thumbnail-preview';
        const placeholder = document.createElement('div');
        placeholder.className = 'page-thumbnail-placeholder';
        placeholder.textContent = `Preparing page ${pageNum}...`;
        preview.appendChild(placeholder);

        const meta = document.createElement('div');
        meta.className = 'page-thumbnail-meta';
        const pageNumberDiv = document.createElement('div');
        pageNumberDiv.className = 'page-number';
        pageNumberDiv.textContent = `Page ${pageNum}`;
        const statusBadge = document.createElement('span');
        statusBadge.className = 'page-status-badge';
        statusBadge.textContent = 'Queued';

        meta.appendChild(pageNumberDiv);
        meta.appendChild(statusBadge);
        div.appendChild(preview);
        div.appendChild(meta);
        div.addEventListener('click', () => {
            processSelectedPage(pageNum).catch(error => {
                console.error(`Open page ${pageNum} failed:`, error);
            });
        });

        thumbnailsContainer.appendChild(div);
        pageThumbnailRefs[pageNum] = { element: div, preview, badge: statusBadge };

        const existingState = pdfPageProcessingState[pageNum];
        if (existingState) {
            setPageProcessingState(pageNum, existingState.status, {
                label: existingState.label,
                detail: existingState.detail,
            });
        } else {
            setPageProcessingState(pageNum, 'queued', { detail: `Waiting for page ${pageNum}...` });
        }
    }

    updatePageProcessingSummary();
}

function setBackendThumbnailPreview(pageNum, imageData, imageWidth = 0, imageHeight = 0) {
    const refs = pageThumbnailRefs[pageNum];
    if (!refs?.preview || !imageData) return;
    const img = document.createElement('img');
    img.alt = `Page ${pageNum}`;
    img.decoding = 'async';
    img.loading = 'eager';
    if (imageWidth > 0) img.width = imageWidth;
    if (imageHeight > 0) img.height = imageHeight;
    img.src = `data:image/png;base64,${imageData}`;
    refs.preview.innerHTML = '';
    refs.preview.appendChild(img);
}

function setBackendThumbnailError(pageNum, message) {
    const refs = pageThumbnailRefs[pageNum];
    if (!refs?.preview) return;
    refs.preview.innerHTML = '';
    const placeholder = document.createElement('div');
    placeholder.className = 'page-thumbnail-placeholder';
    placeholder.style.color = 'var(--danger-color)';
    placeholder.textContent = message || `Preview failed for page ${pageNum}`;
    refs.preview.appendChild(placeholder);
}

async function createPageThumbnails(file, numPages = null) {
    const thumbnailsContainer = document.getElementById('page-thumbnails');
    if (thumbnailsContainer) {
        thumbnailsContainer.innerHTML = '';
    }

    currentThumbnailTaskId++;
    const taskId = currentThumbnailTaskId;
    const sourceKey = getPdfUploadSessionKey(file);
    currentThumbnailWarmupTaskId = taskId;
    currentThumbnailWarmupSourceKey = sourceKey;
    resetPdfPageProcessingState();
    autoOpenReadyPage = false;
    if (Number.isFinite(numPages) && numPages > 0) {
        ensurePageThumbnailPlaceholders(numPages);
    } else if (thumbnailsContainer) {
        thumbnailsContainer.innerHTML = '<div class="info-panel">Preparing thumbnails...</div>';
    }

    const controller = new AbortController();
    try {
        let response = await openCachedPdfThumbnailsResponse(file, controller.signal);
        if (!response) {
            const formData = await buildPdfThumbnailFormData(file, controller.signal);
            response = await fetch(`${ENV.API_BASE_URL}/pdf_thumbnails`, {
                method: 'POST',
                body: formData,
                signal: controller.signal,
            });
        }

        if (!response.ok) {
            throw new Error(await parseHttpErrorResponse(response, `Failed to render PDF thumbnails (${response.status}).`));
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let eventBoundaryIndex = buffer.indexOf('\n\n');
            while (eventBoundaryIndex >= 0) {
                const part = buffer.slice(0, eventBoundaryIndex);
                buffer = buffer.slice(eventBoundaryIndex + 2);
                eventBoundaryIndex = buffer.indexOf('\n\n');
                if (!/\S/.test(part)) continue;
                if (currentThumbnailTaskId !== taskId) return;

                const sseEvent = parseSseEventBlock(part);
                const eventType = sseEvent.eventType;
                const payloadText = getSseEventDataText(sseEvent);

                if (eventType === 'init') {
                    const payload = JSON.parse(payloadText);
                    ensurePageThumbnailPlaceholders(Number(payload.total_pages) || 0);
                    autoOpenReadyPage = Number(payload.total_pages) > 0;
                } else if (eventType === 'thumbnail') {
                    const payload = JSON.parse(payloadText);
                    ensurePageThumbnailPlaceholders(Number(payload.total_pages) || 0);
                    setBackendThumbnailPreview(
                        Number(payload.page_num) || 0,
                        payload.image_data || '',
                        Number(payload.image_width) || 0,
                        Number(payload.image_height) || 0,
                    );
                    await yieldToBrowser();
                } else if (eventType === 'error') {
                    const payload = JSON.parse(payloadText);
                    setBackendThumbnailError(Number(payload.page_num) || 0, payload.error || 'Preview failed');
                } else if (eventType === 'done') {
                    return;
                }
            }
        }

    } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error('Error loading backend thumbnails:', error);
        if (thumbnailsContainer) {
            thumbnailsContainer.innerHTML = '<p>Error loading thumbnails</p>';
        }
    } finally {
        if (currentThumbnailWarmupTaskId === taskId) {
            currentThumbnailWarmupTaskId = 0;
            currentThumbnailWarmupSourceKey = null;
        }
        controller.abort();
    }
}

function updateSelectedThumbnail(selectedPage) {
    selectedThumbnailPageNum = selectedPage;
    const thumbnails = document.querySelectorAll('.page-thumbnail');
    thumbnails.forEach(thumb => {
        if (parseInt(thumb.dataset.page) === selectedPage) {
            thumb.classList.add('selected');
        } else {
            thumb.classList.remove('selected');
        }
    });
}

// Load a cached page
async function loadCachedPage(pageNum, { requestId = pageLoadRequestId, sourceFile = currentPdfFile, pageCache = cachedPages } = {}) {
    waitingPageNum = null;
    const gzipB64 = getPageGzipCacheValue(pageCache, pageNum);
    if (!gzipB64) {
        console.warn(`No cached data for page ${pageNum}`);
        return;
    }

    const compressedBytes = getBase64DecodedByteLength(gzipB64);
    showCanvasStatusOverlay(`Loading page ${pageNum}...`, `Compressed: ${formatBytes(compressedBytes)}`, 'info');

    beginPriorityPageLoad();
    try {
        if (typeof releaseVisualizationMemoryForPageSwitch === 'function') {
            releaseVisualizationMemoryForPageSwitch();
            await yieldToBrowser();
            if (requestId !== pageLoadRequestId) {
                return;
            }
        }
        console.time(`Stream parse page ${pageNum}`);
        const documentData = await parseGzipBase64ToDocumentStreaming(gzipB64, {
            sourceLabel: `cached page ${pageNum}`,
            onProgress(progress) {
                if (requestId !== pageLoadRequestId) return;
                showCanvasStatusOverlay(progress.title, progress.subtitle, 'info');
            }
        });
        console.timeEnd(`Stream parse page ${pageNum}`);

        if (requestId !== pageLoadRequestId) {
            return;
        }

        if (documentData.topLevelValues?.error) {
            throw new Error(documentData.topLevelValues.error);
        }

        showCanvasStatusOverlay('Finalizing page...', `${documentData.shapes.length.toLocaleString()} shapes ready`, 'success');
        await yieldToBrowser();
        if (requestId !== pageLoadRequestId) {
            return;
        }

        await promoteStagedPdfIfNeeded(sourceFile);
        clearVisualization();
        currentPageNum = pageNum;
        dropZone.classList.add('hidden');
        hidePdfPreview();
        loadNormalizedDocument({ ...documentData, pageNum });
        console.log(`Page ${pageNum}: ${jsonShapes.length} shapes`);
        updateSelectedThumbnail(pageNum);
        hideCanvasStatusOverlay();
    } catch (error) {
        if (requestId !== pageLoadRequestId) {
            return;
        }
        showCanvasStatusOverlay(`Error loading page ${pageNum}`, error.message, 'error');
        throw error;
    } finally {
        endPriorityPageLoad();
    }
}

async function processSelectedPage(pageNum) {
    pageLoadRequestId += 1;
    const requestId = pageLoadRequestId;
    updateSelectedThumbnail(pageNum);

    const sourceContext = getPageSelectionContext();
    const isDifferentPageSelection = Boolean(sourceContext.file !== currentPdfFile || pageNum !== currentPageNum);
    if (isDifferentPageSelection) {
        cancelCurrentPageOptimizationWork();
    }

    // If cached, use cache (instant)
    if (getPageGzipCacheValue(sourceContext.cache, pageNum, { touch: false })) {
        await loadCachedPage(pageNum, {
            requestId,
            sourceFile: sourceContext.file,
            pageCache: sourceContext.cache,
        });
        return;
    }

    const pageState = pdfPageProcessingState[pageNum];
    const isBatchActiveForSource = Boolean(stagedPdfFile && sourceContext.file === stagedPdfFile && currentBatchAbortController);
    if (isBatchActiveForSource) {
        if (pageState?.status === 'error') {
            waitingPageNum = null;
            showCanvasStatusOverlay(`Page ${pageNum} failed to process`, pageState.detail || 'Batch processing reported an error for this page.', 'error');
            return;
        }
        waitingPageNum = pageNum;
        showPendingPageOverlay(pageNum, 'This page is still processing in the background. It will open automatically as soon as it is ready.');
        return;
    }

    const sourceSessionKey = getPdfUploadSessionKey(sourceContext.file);
    const isThumbnailWarmupForSource = Boolean(
        stagedPdfFile &&
        sourceContext.file === stagedPdfFile &&
        currentThumbnailWarmupTaskId === currentThumbnailTaskId &&
        sourceSessionKey &&
        currentThumbnailWarmupSourceKey === sourceSessionKey &&
        !currentBatchAbortController
    );
    if (isThumbnailWarmupForSource) {
        waitingPageNum = pageNum;
        showPendingPageOverlay(
            pageNum,
            'Thumbnails are still being prepared. Background page extraction will start right after that and this page will open automatically.'
        );
        return;
    }

    // Fallback: single page API call
    const file = sourceContext.file;
    if (!file) {
        alert('No PDF file loaded.');
        return;
    }
    if (!pageNum || pageNum < 1) {
        alert('Invalid page number.');
        return;
    }
    waitingPageNum = null;

    // Reset saved search state specifically
    cropLengths = null;
    cropLengthsFull = null;
    cropLengthsFiltered = null;
    mainLayers = null;
    anchorBbox = null;
    similarBboxes = [];
    sequenceMatches = [];
    sequencePatternTokens = null;
    searchBboxSize = null;
    expandedNodes = {};
    document.getElementById('found-count').style.display = 'none';

    console.time('API Call');
    showCanvasStatusOverlay(`Loading page ${pageNum}...`, 'Fetching page JSON from backend...', 'info');
    beginPriorityPageLoad();
    try {
        let response = await openCachedProcessPageResponse(file, pageNum);
        if (!response) {
            const formData = await buildPdfRequestFormData(file, pageNum);
            response = await fetch(`${ENV.API_BASE_URL}/process_page`, {
                method: 'POST',
                body: formData
            });
        }
        console.timeEnd('API Call');
        if (!response.ok) {
            invalidatePdfUploadSessionForResponse(response, file);
            throw new Error(await parseHttpErrorResponse(response));
        }
        if (typeof releaseVisualizationMemoryForPageSwitch === 'function') {
            releaseVisualizationMemoryForPageSwitch();
            await yieldToBrowser();
            if (requestId !== pageLoadRequestId) {
                return;
            }
        }
        const documentData = await loadJsonResponseStreaming(response, {
            sourceLabel: `page ${pageNum}`,
            pageNum,
            autoLoad: false,
            onProgress(progress) {
                if (requestId !== pageLoadRequestId) return;
                showCanvasStatusOverlay(progress.title, progress.subtitle, 'info');
            }
        });
        if (requestId !== pageLoadRequestId) {
            return;
        }
        if (documentData?.topLevelValues?.processing_time) {
            console.log(`API processing time: ${documentData.topLevelValues.processing_time} seconds`);
        }
        showCanvasStatusOverlay('Finalizing page...', `${documentData.shapes.length.toLocaleString()} shapes ready`, 'success');
        await yieldToBrowser();
        if (requestId !== pageLoadRequestId) {
            return;
        }

        await promoteStagedPdfIfNeeded(file);
        clearVisualization();
        currentPageNum = pageNum;
        dropZone.classList.add('hidden');
        hidePdfPreview();
        loadNormalizedDocument({ ...documentData, pageNum });
        // Hide preview and load visualization
        hidePdfPreview();
        console.log('jsonShapes length:', jsonShapes.length);
        console.log('Visualization setup completed');
        dropZone.classList.add('hidden');
        // Update selected thumbnail
        updateSelectedThumbnail(pageNum);
        hideCanvasStatusOverlay();
    } catch (error) {
        if (requestId !== pageLoadRequestId) {
            return;
        }
        showCanvasStatusOverlay(`Error loading page ${pageNum}`, error.message, 'error');
        hidePdfPreview();
    } finally {
        endPriorityPageLoad();
    }
}

// Batch process all pages via SSE and cache results
async function processAllPagesBatch(file, { skipCancel = false } = {}) {
    if (!skipCancel) {
        cancelCurrentBatchProcessing();
    }
    currentThumbnailWarmupTaskId = 0;
    currentThumbnailWarmupSourceKey = null;
    stagedPdfFile = file;
    resetStagedPageGzipCache();
    autoOpenReadyPage = true;
    const taskId = currentBatchTaskId;
    const controller = new AbortController();
    currentBatchAbortController = controller;

    if (!hasRenderableDocument()) {
        showCanvasStatusOverlay('Checking PDF cache...', 'Looking for precomputed page gzip before uploading.', 'info');
    }

    try {
        let response = await openCachedProcessAllPagesResponse(file, controller.signal);
        if (!response) {
            if (!hasRenderableDocument()) {
                showCanvasStatusOverlay('Uploading PDF...', 'No complete DB cache found; pages will appear as soon as they are ready.', 'info');
            }
            const formData = await buildPdfRequestFormData(file);
            response = await fetch(`${ENV.API_BASE_URL}/process_all_pages`, {
                method: 'POST',
                body: formData,
                signal: controller.signal
            });
        }

        if (!response.ok) {
            invalidatePdfUploadSessionForResponse(response, file);
            throw new Error(await parseHttpErrorResponse(response));
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let totalPages = 0;
        let totalGzipSize = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let eventBoundaryIndex = buffer.indexOf('\n\n');
            while (eventBoundaryIndex >= 0) {
                const part = buffer.slice(0, eventBoundaryIndex);
                buffer = buffer.slice(eventBoundaryIndex + 2);
                eventBoundaryIndex = buffer.indexOf('\n\n');
                if (!/\S/.test(part)) continue;

                const sseEvent = parseSseEventBlock(part);
                const eventType = sseEvent.eventType;

                if (taskId !== currentBatchTaskId) {
                    return;
                }

                if (eventType === 'init') {
                    const info = JSON.parse(getSseEventDataText(sseEvent));
                    totalPages = info.total_pages;
                    for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
                        if (!pdfPageProcessingState[pageNum]) {
                            setPageProcessingState(pageNum, 'processing', { detail: `Waiting for page ${pageNum}...` });
                        }
                    }
                    updatePageProcessingSummary();
                } else if (eventType === 'page_data') {
                    const { page_num, gzip_size, gzip_data, time: dt, cache_hit } = parseLargePageDataEvent(sseEvent);
                    setPageGzipCacheValue(stagedCachedPages, page_num, gzip_data);
                    totalGzipSize += gzip_size;
                    const pageSource = cache_hit ? 'DB cache' : `${dt}s`;

                    setPageProcessingState(page_num, 'ready', {
                        detail: `Page ${page_num} ready · ${(gzip_size / 1024 / 1024).toFixed(1)} MB · ${dt}s`
                    });
                    if (cache_hit) {
                        setPageProcessingState(page_num, 'ready', {
                            detail: `Page ${page_num} ready - ${(gzip_size / 1024 / 1024).toFixed(1)} MB - ${pageSource}`
                        });
                    }
                    console.log(`Page ${page_num}: ${pageSource}, gzip ${(gzip_size / 1024 / 1024).toFixed(2)}MB`);

                    if (waitingPageNum === page_num && selectedThumbnailPageNum === page_num) {
                        processSelectedPage(page_num).catch(error => {
                            console.error(`Auto-open page ${page_num} failed:`, error);
                        });
                    } else if (autoOpenReadyPage && selectedThumbnailPageNum === null && !hasRenderableDocument()) {
                        autoOpenReadyPage = false;
                        processSelectedPage(page_num).catch(error => {
                            console.error(`Auto-open first ready page ${page_num} failed:`, error);
                        });
                    }
                    await yieldToBrowser();
                } else if (eventType === 'error') {
                    const { page_num, error } = JSON.parse(getSseEventDataText(sseEvent));
                    console.error(`Page ${page_num} error: ${error}`);
                    setPageProcessingState(page_num, 'error', { detail: error });
                    if (waitingPageNum === page_num && selectedThumbnailPageNum === page_num) {
                        showCanvasStatusOverlay(`Page ${page_num} failed to process`, error, 'error');
                    }
                } else if (eventType === 'done') {
                    const info = JSON.parse(getSseEventDataText(sseEvent));
                    console.log(`All pages processed in ${info.total_time}s`);
                    autoOpenReadyPage = false;
                    updatePageProcessingSummary();
                }
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            return;
        }
        showCanvasStatusOverlay('PDF processing failed', error.message, 'error');
        dropZone.classList.remove('hidden');
    } finally {
        if (currentBatchAbortController === controller) {
            currentBatchAbortController = null;
        }
    }
}
