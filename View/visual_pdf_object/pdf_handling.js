// pdf_handling.js

// --- New PDF Handling Functions ---

function getPdfSourceKey(file = currentPdfFile) {
    if (!file) return null;
    return `${file.name}:${file.size}:${file.lastModified}`;
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

    currentPdfDocumentSourceKey = sourceKey;
    pdfRasterPreviewPages = {};
    pdfRasterPreviewLoadingPages = {};

    currentPdfDocumentPromise = currentPdfFile.arrayBuffer()
        .then(arrayBuffer => pdfjsLib.getDocument({ data: arrayBuffer }).promise)
        .then(pdfDocument => {
            if (currentPdfDocumentSourceKey !== sourceKey) {
                try {
                    pdfDocument.destroy();
                } catch (error) {
                    console.warn('Discard stale PDF document error:', error);
                }
                throw new Error('Discarded stale PDF document.');
            }
            currentPdfDocument = pdfDocument;
            return pdfDocument;
        })
        .catch(error => {
            if (currentPdfDocumentSourceKey === sourceKey) {
                currentPdfDocument = null;
                currentPdfDocumentPromise = null;
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
        const scale = Math.min(containerRect.width / viewport.width, containerRect.height / viewport.height) * 0.9;
        const scaledViewport = page.getViewport({ scale });

        canvas.height = scaledViewport.height;
        canvas.width = scaledViewport.width;

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

async function createPageThumbnails(file, numPages) {
    const thumbnailsContainer = document.getElementById('page-thumbnails');
    thumbnailsContainer.innerHTML = '';

    currentThumbnailTaskId++;
    const taskId = currentThumbnailTaskId;

    let pdf = null;
    let ownsPdfDocument = false;
    try {
        if (currentPdfFile === file) {
            pdf = await ensureCurrentPdfDocument();
        } else {
            const arrayBuffer = await file.arrayBuffer();
            pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            ownsPdfDocument = true;
        }

        // Tß║ío tr╞░ß╗¢c list divs ─æß╗â giß╗» ─æ├║ng thß╗⌐ tß╗▒ c├íc trang
        const thumbnailDivs = [];
        for (let i = 1; i <= numPages; i++) {
            const div = document.createElement('div');
            div.className = 'page-thumbnail';
            div.dataset.page = i;

            const loadingText = document.createElement('div');
            loadingText.textContent = `Loading Page ${i}...`;
            loadingText.style.padding = '10px';
            loadingText.style.textAlign = 'center';
            loadingText.style.fontSize = '12px';
            loadingText.style.color = 'var(--text-color-secondary)';
            div.appendChild(loadingText);

            thumbnailsContainer.appendChild(div);
            thumbnailDivs.push({ pageNum: i, element: div });
        }

        // Render ─æß╗ông thß╗¥i bß║▒ng Worker Pool (giß╗¢i hß║ín sß╗æ luß╗ông)
        const CONCURRENCY_LIMIT = 8;
        let currentIndex = 0;

        async function renderWorker() {
            while (currentIndex < numPages) {
                if (currentThumbnailTaskId !== taskId) break;

                const workIndex = currentIndex++;
                const { pageNum, element } = thumbnailDivs[workIndex];

                try {
                    const page = await pdf.getPage(pageNum);
                    const viewport = page.getViewport({ scale: 0.2 });

                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    await page.render({ canvasContext: context, viewport: viewport }).promise;

                    const pageNumberDiv = document.createElement('div');
                    pageNumberDiv.className = 'page-number';
                    pageNumberDiv.textContent = `Page ${pageNum}`;

                    // Cß║¡p nhß║¡t DOM
                    element.innerHTML = '';
                    element.appendChild(canvas);
                    element.appendChild(pageNumberDiv);

                    element.addEventListener('click', () => {
                        processSelectedPage(pageNum);
                        updateSelectedThumbnail(pageNum);
                    });

                    // FIXED: Ensure page cleanup even on error
                    if (page) {
                        try { page.cleanup(); } catch (e) { /* ignore */ }
                    }
                } catch (err) {
                    console.error(`Error rendering thumbnail page ${pageNum}:`, err);
                    element.innerHTML = `<div style="padding:10px;text-align:center;color:red;">Error P${pageNum}</div>`;
                }
            }
        }

        // Chß║íy nhiß╗üu worker c├╣ng l├║c
        const workers = [];
        for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, numPages); i++) {
            workers.push(renderWorker());
        }
        await Promise.all(workers);

    } catch (error) {
        console.error('Error creating thumbnails:', error);
        thumbnailsContainer.innerHTML = '<p>Error loading thumbnails</p>';
    } finally {
        if (pdf && ownsPdfDocument) {
            try { await pdf.destroy(); } catch (e) { console.warn('PDF destroy error:', e); }
        }
    }
}

function updateSelectedThumbnail(selectedPage) {
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
async function loadCachedPage(pageNum) {
    currentPageNum = pageNum;
    const gzipB64 = cachedPages[pageNum];
    if (!gzipB64) {
        console.warn(`No cached data for page ${pageNum}`);
        return;
    }

    // Optimize: Clear previous visualization (unzipped data) BEFORE decompressing new one
    // This prevents holding two unzipped pages in memory at the same time
    clearVisualization();

    const compressedBytes = getBase64DecodedByteLength(gzipB64);
    showLoadingPopup(`Loading page ${pageNum}...`, `Compressed: ${formatBytes(compressedBytes)}`);

    try {
        console.time(`Stream parse page ${pageNum}`);
        const documentData = await parseGzipBase64ToDocumentStreaming(gzipB64, {
            sourceLabel: `cached page ${pageNum}`
        });
        console.timeEnd(`Stream parse page ${pageNum}`);

        if (documentData.topLevelValues?.error) {
            throw new Error(documentData.topLevelValues.error);
        }

        updateLoadingPopup('Finalizing page...', `${documentData.shapes.length.toLocaleString()} shapes ready`);
        await yieldToBrowser();
        loadNormalizedDocument({ ...documentData, pageNum });
        console.log(`Page ${pageNum}: ${jsonShapes.length} shapes`);

        dropZone.classList.add('hidden');
        updateSelectedThumbnail(pageNum);
    } finally {
        hideLoadingPopup();
    }
}

async function processSelectedPage(pageNum) {
    // If cached, use cache (instant)
    if (cachedPages[pageNum]) {
        await loadCachedPage(pageNum);
        return;
    }

    // Fallback: single page API call
    const file = currentPdfFile;
    if (!file) {
        alert('No PDF file loaded.');
        return;
    }
    if (!pageNum || pageNum < 1) {
        alert('Invalid page number.');
        return;
    }
    currentPageNum = pageNum;
    // Clear current visualization before showing preview
    clearVisualization();

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

    // Show PDF preview while processing
    await renderPdfPreview(file, pageNum);
    console.time('API Call');
    showLoadingPopup('Loading page JSON...', `Page ${pageNum}`);
    try {
        const formData = new FormData();
        formData.append('pdf_file', file);
        formData.append('page_num', pageNum);
        const response = await fetch(`${ENV.PDF_API_BASE_URL}/process_page`, {
            method: 'POST',
            body: formData
        });
        console.timeEnd('API Call');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const documentData = await loadJsonResponseStreaming(response, {
            sourceLabel: `page ${pageNum}`,
            pageNum
        });
        if (documentData?.topLevelValues?.processing_time) {
            console.log(`API processing time: ${documentData.topLevelValues.processing_time} seconds`);
        }
        // Hide preview and load visualization
        hidePdfPreview();
        console.log('jsonShapes length:', jsonShapes.length);
        console.log('Visualization setup completed');
        dropZone.classList.add('hidden');
        // Update selected thumbnail
        updateSelectedThumbnail(pageNum);
    } catch (error) {
        alert('Error processing PDF: ' + error.message);
        hidePdfPreview();
    } finally {
        hideLoadingPopup();
    }
}

// Batch process all pages via SSE and cache results
async function processAllPagesBatch(file) {
    cachedPages = {};
    const overlay = document.getElementById('batch-progress-overlay');
    const bar = document.getElementById('batch-progress-bar');
    const text = document.getElementById('batch-progress-text');
    const subtitle = document.getElementById('batch-progress-subtitle');
    const sizeText = document.getElementById('batch-progress-size');

    overlay.style.display = 'flex';
    bar.style.width = '0%';
    text.textContent = 'Uploading PDF...';
    subtitle.textContent = 'Starting parallel processing...';
    sizeText.textContent = '';

    const formData = new FormData();
    formData.append('pdf_file', file);

    try {
        const response = await fetch(`${ENV.PDF_API_BASE_URL}/process_all_pages`, {
            method: 'POST',
            body: formData
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

                if (eventType === 'init') {
                    const info = JSON.parse(eventData);
                    totalPages = info.total_pages;
                    subtitle.textContent = `Processing ${totalPages} pages in parallel...`;
                    text.textContent = `0 / ${totalPages} pages`;
                } else if (eventType === 'page_data') {
                    const { page_num, completed, gzip_size, gzip_data, time: dt } = JSON.parse(eventData);
                    cachedPages[page_num] = gzip_data;
                    totalGzipSize += gzip_size;

                    const pct = Math.round((completed / totalPages) * 100);
                    bar.style.width = pct + '%';
                    text.textContent = `${completed} / ${totalPages} pages`;
                    sizeText.textContent = `Page ${page_num} done (${(gzip_size / 1024 / 1024).toFixed(1)}MB) | Total: ${(totalGzipSize / 1024 / 1024).toFixed(1)}MB`;
                    console.log(`Page ${page_num}: ${dt}s, gzip ${(gzip_size / 1024 / 1024).toFixed(2)}MB`);
                } else if (eventType === 'error') {
                    const { page_num, error, completed } = JSON.parse(eventData);
                    console.error(`Page ${page_num} error: ${error}`);
                    const pct = Math.round((completed / totalPages) * 100);
                    bar.style.width = pct + '%';
                    text.textContent = `${completed} / ${totalPages} pages`;
                } else if (eventType === 'done') {
                    const info = JSON.parse(eventData);
                    console.log(`All pages processed in ${info.total_time}s`);
                    subtitle.textContent = `Done in ${info.total_time}s! Loading page 1...`;
                    bar.style.width = '100%';
                }
            }
        }

        // All done - load page 1 and hide overlay
        overlay.style.display = 'none';
        if (cachedPages[1]) {
            await loadCachedPage(1);
        }
    } catch (error) {
        overlay.style.display = 'none';
        alert('Error processing PDF: ' + error.message);
        dropZone.classList.remove('hidden');
    }
}