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
    cachedPageImagePromise = (async () => {
        let latestCanvas = null;

        while (cachedPageImageRequestedPageNum) {
            const targetPage = cachedPageImageRequestedPageNum;
            cachedPageImageRequestedPageNum = null;
            console.time(`Pre-render page ${targetPage} image`);

            let page = null;
            try {
                const pdf = await ensureCurrentPdfDocument();
                page = await pdf.getPage(targetPage);

                const scale = CONFIG.PDF_PAGE_CACHE_SCALE || 3;
                const viewport = page.getViewport({ scale });

                const offCanvas = document.createElement('canvas');
                offCanvas.width = Math.max(1, Math.ceil(viewport.width));
                offCanvas.height = Math.max(1, Math.ceil(viewport.height));
                const offCtx = offCanvas.getContext('2d');
                if (!offCtx) continue;

                await page.render({
                    canvasContext: offCtx,
                    viewport
                }).promise;

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
                console.warn(`Pre-render page ${targetPage} failed:`, error);
            } finally {
                if (page) {
                    try { page.cleanup(); } catch (e) {}
                }
                console.timeEnd(`Pre-render page ${targetPage} image`);
            }
        }

        return latestCanvas;
    })().finally(() => {
        cachedPageImageLoading = false;
        cachedPageImagePromise = null;
    });

    return cachedPageImagePromise;
}

function hidePdfPreview() {
    const pdfPreview = document.getElementById('pdf-preview');
    pdfPreview.style.display = 'none';
    pdfPreview.innerHTML = '';
}

function cancelCurrentBatchProcessing() {
    currentBatchTaskId += 1;
    pageLoadRequestId += 1;
    autoOpenReadyPage = false;
    waitingPageNum = null;
    hideCanvasStatusOverlay();

    if (currentBatchAbortController) {
        currentBatchAbortController.abort();
        currentBatchAbortController = null;
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
    const thumbnailsContainer = document.getElementById('page-thumbnails');
    if (thumbnailsContainer) {
        thumbnailsContainer.innerHTML = '';
    }
    hideCanvasStatusOverlay();
    hidePdfPreview();
    stagedPdfFile = null;
    stagedCachedPages = {};
    resetPdfPageProcessingState();
}

function getThumbnailRenderScale(page, previewElement) {
    const baseViewport = page.getViewport({ scale: 1 });
    const previewWidth = Math.max(96, Math.min(previewElement?.clientWidth || 120, 128));
    let scale = previewWidth / Math.max(1, baseViewport.width);

    const maxPixels = 18000;
    const estimatedPixels = baseViewport.width * baseViewport.height * scale * scale;
    if (estimatedPixels > maxPixels && estimatedPixels > 0) {
        scale *= Math.sqrt(maxPixels / estimatedPixels);
    }

    return Math.max(0.08, Math.min(scale, 0.16));
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

        if (refs.preview && !refs.preview.querySelector('canvas')) {
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

async function createPageThumbnails(file, numPages = null) {
    const thumbnailsContainer = document.getElementById('page-thumbnails');
    thumbnailsContainer.innerHTML = '';

    currentThumbnailTaskId++;
    const taskId = currentThumbnailTaskId;
    resetPdfPageProcessingState();
    autoOpenReadyPage = false;

    let pdf = null;
    let ownsPdfDocument = false;
    let ownedPdfUrl = null;
    try {
        if (currentPdfFile === file) {
            pdf = await ensureCurrentPdfDocument();
        } else {
            ownedPdfUrl = URL.createObjectURL(file);
            pdf = await pdfjsLib.getDocument({
                ...window.PDFJS_DOCUMENT_OPTIONS,
                url: ownedPdfUrl,
            }).promise;
            ownsPdfDocument = true;
        }

        const totalPages = Number.isFinite(numPages) && numPages > 0 ? numPages : pdf.numPages;
        autoOpenReadyPage = totalPages > 0;

        // Tß║ío tr╞░ß╗¢c list divs ─æß╗â giß╗» ─æ├║ng thß╗⌐ tß╗▒ c├íc trang
        const thumbnailDivs = [];
        for (let i = 1; i <= totalPages; i++) {
            const div = document.createElement('div');
            div.className = 'page-thumbnail';
            div.dataset.page = i;

            const preview = document.createElement('div');
            preview.className = 'page-thumbnail-preview';
            preview.innerHTML = `<div class="page-thumbnail-placeholder">Preparing page ${i}...</div>`;

            const meta = document.createElement('div');
            meta.className = 'page-thumbnail-meta';

            const pageNumberDiv = document.createElement('div');
            pageNumberDiv.className = 'page-number';
            pageNumberDiv.textContent = `Page ${i}`;

            const statusBadge = document.createElement('span');
            statusBadge.className = 'page-status-badge';
            statusBadge.textContent = 'Queued';

            meta.appendChild(pageNumberDiv);
            meta.appendChild(statusBadge);
            div.appendChild(preview);
            div.appendChild(meta);

            div.addEventListener('click', () => {
                processSelectedPage(i).catch(error => {
                    console.error(`Open page ${i} failed:`, error);
                });
            });

            thumbnailsContainer.appendChild(div);
            pageThumbnailRefs[i] = { element: div, preview, badge: statusBadge };
            setPageProcessingState(i, 'queued', { detail: `Preparing page ${i}...` });
            thumbnailDivs.push({ pageNum: i, element: div, preview, badge: statusBadge });
        }
        updatePageProcessingSummary();

        for (const { pageNum, preview } of thumbnailDivs) {
            if (currentThumbnailTaskId !== taskId) {
                break;
            }

            let page = null;
            try {
                page = await pdf.getPage(pageNum);
                const scale = getThumbnailRenderScale(page, preview);
                const viewport = page.getViewport({ scale });

                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d', { alpha: false });
                if (!context) {
                    throw new Error('Cannot create thumbnail context');
                }

                canvas.height = Math.max(1, Math.round(viewport.height));
                canvas.width = Math.max(1, Math.round(viewport.width));

                await page.render({ canvasContext: context, viewport }).promise;
                if (currentThumbnailTaskId !== taskId) {
                    break;
                }

                preview.innerHTML = '';
                preview.appendChild(canvas);
                await yieldToBrowser();
            } catch (err) {
                console.error(`Error rendering thumbnail page ${pageNum}:`, err);
                preview.innerHTML = `<div class="page-thumbnail-placeholder" style="color: var(--danger-color);">Preview failed for page ${pageNum}</div>`;
            } finally {
                if (page) {
                    try { page.cleanup(); } catch (e) { /* ignore */ }
                }
            }
        }

    } catch (error) {
        console.error('Error creating thumbnails:', error);
        thumbnailsContainer.innerHTML = '<p>Error loading thumbnails</p>';
    } finally {
        if (pdf && ownsPdfDocument) {
            try { await pdf.destroy(); } catch (e) { console.warn('PDF destroy error:', e); }
        }
        if (ownedPdfUrl) {
            URL.revokeObjectURL(ownedPdfUrl);
        }
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
    const gzipB64 = pageCache[pageNum];
    if (!gzipB64) {
        console.warn(`No cached data for page ${pageNum}`);
        return;
    }

    const compressedBytes = getBase64DecodedByteLength(gzipB64);
    showCanvasStatusOverlay(`Loading page ${pageNum}...`, `Compressed: ${formatBytes(compressedBytes)}`, 'info');

    try {
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
        if (requestId !== pageLoadRequestId) {
            return;
        }
    }
}

async function processSelectedPage(pageNum) {
    pageLoadRequestId += 1;
    const requestId = pageLoadRequestId;
    updateSelectedThumbnail(pageNum);

    const sourceContext = getPageSelectionContext();

    // If cached, use cache (instant)
    if (sourceContext.cache[pageNum]) {
        await loadCachedPage(pageNum, {
            requestId,
            sourceFile: sourceContext.file,
            pageCache: sourceContext.cache,
        });
        return;
    }

    const pageState = pdfPageProcessingState[pageNum];
    const isBatchPending = stagedPdfFile && currentBatchAbortController && (!pageState || (pageState.status !== 'ready' && pageState.status !== 'error'));
    if (isBatchPending) {
        waitingPageNum = pageNum;
        showPendingPageOverlay(pageNum, 'This page is still processing in the background. It will open automatically as soon as it is ready.');
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
    try {
        const formData = new FormData();
        formData.append('pdf_file', file);
        formData.append('page_num', pageNum);
        const response = await fetch(`${ENV.API_BASE_URL}/process_page`, {
            method: 'POST',
            body: formData
        });
        console.timeEnd('API Call');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
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
    }
}

// Batch process all pages via SSE and cache results
async function processAllPagesBatch(file) {
    cancelCurrentBatchProcessing();
    stagedPdfFile = file;
    stagedCachedPages = {};
    autoOpenReadyPage = true;
    const taskId = currentBatchTaskId;
    const controller = new AbortController();
    currentBatchAbortController = controller;

    if (!hasRenderableDocument()) {
        showCanvasStatusOverlay('Uploading PDF...', 'Pages will appear one by one as soon as they are ready.', 'info');
    }

    const formData = new FormData();
    formData.append('pdf_file', file);

    try {
        const response = await fetch(`${ENV.API_BASE_URL}/process_all_pages`, {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
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

            // Parse SSE events from buffer
            const parts = buffer.split('\n\n');
            buffer = parts.pop(); // keep incomplete event

            for (const part of parts) {
                if (!part.trim()) continue;

                let eventType = '', eventData = '';
                for (const line of part.split('\n')) {
                    if (line.startsWith('event: ')) eventType = line.slice(7);
                    if (line.startsWith('data: ')) eventData += line.slice(6);
                }

                if (taskId !== currentBatchTaskId) {
                    return;
                }

                if (eventType === 'init') {
                    const info = JSON.parse(eventData);
                    totalPages = info.total_pages;
                    for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
                        if (!pdfPageProcessingState[pageNum]) {
                            setPageProcessingState(pageNum, 'processing', { detail: `Waiting for page ${pageNum}...` });
                        }
                    }
                    updatePageProcessingSummary();
                } else if (eventType === 'page_data') {
                    const { page_num, completed, gzip_size, gzip_data, time: dt } = JSON.parse(eventData);
                    stagedCachedPages[page_num] = gzip_data;
                    totalGzipSize += gzip_size;

                    setPageProcessingState(page_num, 'ready', {
                        detail: `Page ${page_num} ready · ${(gzip_size / 1024 / 1024).toFixed(1)} MB · ${dt}s`
                    });
                    console.log(`Page ${page_num}: ${dt}s, gzip ${(gzip_size / 1024 / 1024).toFixed(2)}MB`);

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
                } else if (eventType === 'error') {
                    const { page_num, error, completed } = JSON.parse(eventData);
                    console.error(`Page ${page_num} error: ${error}`);
                    setPageProcessingState(page_num, 'error', { detail: error });
                    if (waitingPageNum === page_num && selectedThumbnailPageNum === page_num) {
                        showCanvasStatusOverlay(`Page ${page_num} failed to process`, error, 'error');
                    }
                } else if (eventType === 'done') {
                    const info = JSON.parse(eventData);
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