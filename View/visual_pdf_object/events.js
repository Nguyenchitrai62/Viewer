// events.js

// Events
window.addEventListener('keydown', e => {
    const isTextInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z' && !isTextInput) {
        e.preventDefault();
        undoManualAnnotation();
        return;
    }
    if ((e.ctrlKey || e.metaKey || e.altKey) || isTextInput) {
        return;
    }
    if (e.key.toLowerCase() === 'd') {
        btnDrawBbox.click();
    }
    if (e.key.toLowerCase() === 'f') {
        btnVLMExtract.click();
    }
    if (e.key.toLowerCase() === 'j') {
        btnLabelJunction.click();
    }
    if (e.key.toLowerCase() === 'c') {
        btnLabelConnect.click();
    }
    // Cancel modes with Escape
    if (e.key === 'Escape') {
        if (isVLMBboxMode) {
            btnVLMExtract.click();
        } else if (isDrawingBbox) {
            btnDrawBbox.click();
        } else if (annotationMode) {
            deactivateManualLabelMode();
        }
    }
});
window.addEventListener('resize', resizeCanvas);
dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', async e => {
    e.preventDefault();
    dropZone.classList.add('hidden');
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];

    if (file && file.name.toLowerCase().endsWith('.pdf')) {
        if (currentPdfFile && currentPdfFile !== file && typeof releaseCurrentPdfResources === 'function') {
            await releaseCurrentPdfResources();
        }
        currentPdfFile = file;
        try {
            // Get page count for thumbnails
            const formData = new FormData();
            formData.append('file', file);
            const response = await fetch(`${ENV.PDF_API_BASE_URL}/get_pdf_pages`, {
                method: 'POST',
                body: formData
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            if (data.error) {
                throw new Error(data.error);
            }
            // Create thumbnails for all pages
            createPageThumbnails(file, data.pages);
            // Start batch processing all pages
            clearVisualization();
            processAllPagesBatch(file);
        } catch (error) {
            alert('Error loading PDF: ' + error.message);
            dropZone.classList.remove('hidden');
        }
    } else if (file && file.name.toLowerCase().endsWith('.json')) {
        try {
            await loadJsonFileStreaming(file);
        } catch (error) {
            alert('Lỗi khi đọc tệp JSON.\n' + error.message);
            dropZone.classList.remove('hidden');
        }
    } else {
        alert('Please drop a PDF or JSON file.');
        dropZone.classList.remove('hidden');
    }
});

// Auto-load example if `example` query parameter is provided
(function autoLoadExampleFromQuery() {
    try {
        const params = new URLSearchParams(window.location.search);
        const examplePath = params.get('example');
        if (!examplePath) return;
        // Hide and disable drop zone to prevent uploads when example forced
        dropZone.classList.add('hidden');
        dropZone.innerHTML = `<p>Example forced: ${examplePath}</p>`;
        dropZone.style.pointerEvents = 'none';

        // Replace export button with Back-to-Portfolio link in the left panel
        const exportContainer = document.getElementById('btn-export-svg-container');
        const originalExportHTML = exportContainer ? exportContainer.innerHTML : null;
        if (exportContainer) {
            exportContainer.innerHTML = `\n                        <a href="index.html" id="back-btn-panel" style="display:inline-flex; align-items:center; gap:8px; padding:8px 12px; background:#fff; border-radius:6px; text-decoration:none; color:#333; font-weight:600; box-shadow:0 2px 8px rgba(0,0,0,0.08);">\n                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>\n                            Back to Portfolio\n                        </a>\n                    `;
        }

        // Show loading overlay while fetching/parsing
        const loadingPopup = document.getElementById('loading-popup');
        if (loadingPopup) loadingPopup.style.display = 'flex';

        // Try to use prefetched JSON from sessionStorage first
        const storageKey = `prefetch_example::${examplePath}`;
        const prefetched = sessionStorage.getItem(storageKey);
        const finalizeFailure = (err) => {
            console.error('Example load failed', err);
            if (loadingPopup) loadingPopup.style.display = 'none';
            // restore drop zone and export button on failure
            dropZone.classList.remove('hidden');
            dropZone.style.pointerEvents = '';
            if (exportContainer && originalExportHTML !== null) exportContainer.innerHTML = originalExportHTML;
        };

        const processText = async (text) => {
            try {
                clearVisualization();
                cachedPages = {};
                if (typeof releaseCurrentPdfResources === 'function') {
                    releaseCurrentPdfResources().catch(error => {
                        console.warn('Release PDF resources error:', error);
                    });
                }
                currentPdfFile = null;
                dropZone.classList.add('hidden');
                dropZone.style.pointerEvents = 'none';
                await loadParsedJsonDocument(JSON.parse(text), { pageNum: 1 });
                if (text.length <= CONFIG.JSON_SESSION_CACHE_MAX_BYTES) {
                    try {
                        sessionStorage.setItem(storageKey, text);
                    } catch (error) {
                        console.warn('Failed to cache example JSON in sessionStorage:', error);
                    }
                }
                hideLoadingPopup();
            } catch (err) {
                finalizeFailure(err);
            }
        };

        if (prefetched) {
            // use already-fetched JSON
            processText(prefetched);
        } else {
            // Fetch the example JSON (relative path)
            (async () => {
                try {
                    const response = await fetch(examplePath);
                    if (!response.ok) throw new Error('Network response was not ok');
                    clearVisualization();
                    cachedPages = {};
                    if (typeof releaseCurrentPdfResources === 'function') {
                        releaseCurrentPdfResources().catch(error => {
                            console.warn('Release PDF resources error:', error);
                        });
                    }
                    currentPdfFile = null;
                    dropZone.classList.add('hidden');
                    dropZone.style.pointerEvents = 'none';
                    showLoadingPopup('Loading example JSON...', examplePath);
                    await loadJsonResponseStreaming(response, {
                        sourceLabel: examplePath,
                        sessionCacheKey: storageKey
                    });
                    hideLoadingPopup();
                } catch (err) {
                    finalizeFailure(err);
                }
            })();
        }
    } catch (err) {
        console.error('autoLoadExampleFromQuery error', err);
    }
})();

function applyManualLabelPanelState(collapsed) {
    isManualLabelPanelCollapsed = collapsed;
    if (manualLabelPanel) {
        manualLabelPanel.classList.toggle('is-collapsed', collapsed);
    }
    if (btnToggleManualLabelPanel) {
        btnToggleManualLabelPanel.setAttribute('aria-expanded', String(!collapsed));
        btnToggleManualLabelPanel.title = collapsed ? 'Mở rộng' : 'Thu gọn';
    }
    try {
        localStorage.setItem('visual_pdf_object.manual_label_collapsed', collapsed ? '1' : '0');
    } catch (error) {
        console.warn('Failed to persist manual label panel state:', error);
    }
}

try {
    const storedCollapsed = localStorage.getItem('visual_pdf_object.manual_label_collapsed');
    applyManualLabelPanelState(storedCollapsed !== '0');
} catch (error) {
    applyManualLabelPanelState(true);
}

if (btnToggleManualLabelPanel) {
    btnToggleManualLabelPanel.addEventListener('click', () => {
        applyManualLabelPanelState(!isManualLabelPanelCollapsed);
    });
}

if (manualLabelPanel) {
    ['mousedown', 'mouseup', 'mousemove', 'wheel', 'contextmenu'].forEach(eventName => {
        manualLabelPanel.addEventListener(eventName, event => {
            event.stopPropagation();
            if (eventName === 'contextmenu') {
                event.preventDefault();
            }
        });
    });
}

btnDetectPipeline.addEventListener('click', detectPipeline);
btnExportPipelineJson.addEventListener('click', () => {
    if (!pipelineRawResults) {
        alert('No pipeline data to export. Please run "Detect Pipeline" first.');
        return;
    }

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(pipelineRawResults, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `pipeline_detect_page_${currentPageNum || 1}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    // Open visual_pipeline_fire.html
    window.open('visual_pipeline_fire.html', '_blank');
});

btnExportRevitJson.addEventListener('click', async () => {
    if (!pipelineRawResults || pipelineRawResults.length === 0) {
        alert('No pipeline data available. Please run "Detect Pipeline" first.');
        return;
    }

    const popup = document.getElementById('loading-popup');
    if (popup) popup.style.display = 'flex';

    try {
        // Call export_revit endpoint
        const startTime = performance.now();
        const response = await fetch(`${ENV.PDF_API_BASE_URL}/export_revit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input_data: pipelineRawResults })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        const endTime = performance.now();
        console.log(`Export Revit API Call took ${((endTime - startTime) / 1000).toFixed(3)} seconds`);
        console.log('Revit result:', result);

        if (result.error) {
            throw new Error(result.error);
        }

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(result, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `revit_pipeline_detect_page_${currentPageNum || 1}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        
        // Open revit_viewer.html
        window.open('revit_viewer.html', '_blank');

    } catch (error) {
        console.error('Export Revit Error:', error);
        alert(`Error during export to Revit: ${error.message}`);
    } finally {
        if (popup) popup.style.display = 'none';
    }
});

btnExportSvg.addEventListener('click', exportToSVG);
document.getElementById('btn-export-images').addEventListener('click', exportLayerImages);
btnLabelJunction.addEventListener('click', () => setAnnotationMode('junction'));
btnLabelConnect.addEventListener('click', () => setAnnotationMode('connect'));
btnUndoLabel.addEventListener('click', undoManualAnnotation);
btnClearLabels.addEventListener('click', () => setAnnotationMode('delete'));
btnExportLabelPackage.addEventListener('click', exportAnnotatedLayerPackage);
canvasContainer.addEventListener('contextmenu', e => {
    e.preventDefault();
});
btnToggleLayerMode.addEventListener('click', () => {
    if (manualAnnotations.length || pendingConnectPoint) {
        resetManualLabelState({ message: 'Đã xóa nhãn do đổi chế độ layer.', tone: 'info' });
    }
    currentLayerField = (currentLayerField === 'layer_1') ? 'layer' : 'layer_1';
    btnToggleLayerMode.textContent = `Mode: ${currentLayerField === 'layer_1' ? 'Layer 1' : 'Layer'}`;
    
    // Re-index and refresh UI
    if (jsonShapes) {
        buildLayerIndex();
        setupVisualization();
        scheduleDraw();
    }
});
btnDrawBbox.addEventListener('click', () => {
    isDrawingBbox = !isDrawingBbox;
    btnDrawBbox.textContent = isDrawingBbox ? UI_TEXT.CANCEL : UI_TEXT.DRAW_FIND;
    btnDrawBbox.classList.toggle('active', isDrawingBbox);
    canvasContainer.classList.toggle('drawing-bbox', isDrawingBbox); // Update cursor style
    
    if (isDrawingBbox) {
        // Cancel VLM mode if active
        if (isVLMBboxMode) {
            isVLMBboxMode = false;
            btnVLMExtract.textContent = UI_TEXT.VLM_EXTRACT;
            btnVLMExtract.classList.remove('active');
            canvasContainer.classList.remove('vlm-bbox-mode');
            vlmBboxStart = null;
            vlmBboxEnd = null;
            isVLMDrawing = false;
        }
        if (annotationMode) {
            deactivateManualLabelMode();
        }
        mouseX = (canvas.width / zoom) / 2;
        mouseY = (canvas.height / zoom) / 2;
        // Show mode label
        updateModeLabel('find');
        scheduleCrosshairOverlayDraw();
    } else {
        bboxStart = null;
        currentBbox = null;
        cropLengths = null;
        cropLengthsFull = null;
        cropLengthsFiltered = null;
        mainLayers = null;
        anchorBbox = null;
        similarBboxes = [];
        searchBboxSize = null;
        expandedNodes = {};
        // Hide mode label
        updateModeLabel(null);
        scheduleCrosshairOverlayDraw();
        scheduleDraw();
    }
});
btnResetFilter.addEventListener('click', () => {
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
    pendingVLMCrop = null;
    pendingVLMBbox = null;
    if (typeof clearDetectedCellOverlay === 'function') {
        clearDetectedCellOverlay();
    } else {
        extractedCellOverlays = [];
        extractedCellDownloadBundle = null;
    }
    document.getElementById('found-count').style.display = 'none';
    isDrawingBbox = false;
    btnDrawBbox.textContent = UI_TEXT.DRAW_FIND;
    btnDrawBbox.classList.remove('active');
    canvasContainer.classList.remove('drawing-bbox'); // Reset cursor
    scheduleCrosshairOverlayDraw();
    scheduleDraw();
});

// VLM Extract button handler (btnVLMExtract declared in state.js)
btnVLMExtract.addEventListener('click', () => {
    isVLMBboxMode = !isVLMBboxMode;
    btnVLMExtract.textContent = isVLMBboxMode ? UI_TEXT.CANCEL : UI_TEXT.VLM_EXTRACT;
    btnVLMExtract.classList.toggle('active', isVLMBboxMode);
    canvasContainer.classList.toggle('vlm-bbox-mode', isVLMBboxMode);

    if (isVLMBboxMode) {
        // Cancel other modes
        if (isDrawingBbox) {
            isDrawingBbox = false;
            btnDrawBbox.textContent = UI_TEXT.DRAW_FIND;
            btnDrawBbox.classList.remove('active');
            canvasContainer.classList.remove('drawing-bbox');
        }
        if (annotationMode) {
            deactivateManualLabelMode();
        }
        mouseX = (canvas.width / zoom) / 2;
        mouseY = (canvas.height / zoom) / 2;
        // Show mode label and crosshair immediately
        updateModeLabel('vlm');
        scheduleCrosshairOverlayDraw();
    } else {
        // Reset VLM state
        vlmBboxStart = null;
        vlmBboxEnd = null;
        isVLMDrawing = false;
        // Hide mode label
        updateModeLabel(null);
        scheduleCrosshairOverlayDraw();
        scheduleDraw();
    }
});

// Helper function to update mode label
function updateModeLabel(mode) {
    const label = document.getElementById('mode-label');
    if (!mode) {
        label.style.display = 'none';
        return;
    }
    
    label.className = 'mode-label';
    if (mode === 'find') {
        label.textContent = UI_TEXT.MODE_FIND;
        label.classList.add('find-mode');
    } else if (mode === 'vlm') {
        label.textContent = UI_TEXT.VLM_SHORT;
        label.classList.add('vlm-mode');
    } else if (mode === 'junction') {
        label.textContent = UI_TEXT.MODE_JUNCTION;
        label.classList.add('junction-mode');
    } else if (mode === 'connect') {
        label.textContent = pendingConnectPoint ? `${UI_TEXT.MODE_CONNECT} • Point 2` : UI_TEXT.MODE_CONNECT;
        label.classList.add('connect-mode');
    } else if (mode === 'delete') {
        label.textContent = UI_TEXT.MODE_DELETE;
        label.classList.add('delete-mode');
    }
    label.style.display = 'block';
}

canvasContainer.addEventListener('mousedown', e => {
    const rect = canvasContainer.getBoundingClientRect();
    const worldX = (e.clientX - rect.left - offsetX) / zoom;
    const worldY = (e.clientY - rect.top - offsetY) / zoom;
    activeMouseButton = e.button;
    if (e.button === 2) {
        e.preventDefault();
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        setInteractionState(true);
        return;
    }
    if (e.button !== 0) {
        return;
    }
    if (!isDrawingBbox && !isVLMBboxMode && !annotationMode) setInteractionState(true); // Start interaction only for pan, not bbox
    if (annotationMode) {
        handleAnnotationCanvasClick(worldX, worldY);
        return;
    }
    if (isVLMBboxMode) {
        vlmBboxStart = { x: worldX, y: worldY };
        vlmBboxEnd = { ...vlmBboxStart };
        isVLMDrawing = true;
        scheduleCrosshairOverlayDraw();
    } else if (isDrawingBbox) {
        bboxStart = { x: worldX, y: worldY };
        currentBbox = null;
        scheduleCrosshairOverlayDraw();
    } else {
        isDragging = true;
        lastX = e.clientX; lastY = e.clientY;
    }
});
canvasContainer.addEventListener('mouseup', e => {
    if (activeMouseButton === 2 || e.button === 2) {
        isDragging = false;
        activeMouseButton = null;
        setInteractionState(false);
        return;
    }
    if (e.button !== 0) {
        activeMouseButton = null;
        return;
    }
    setInteractionState(false); // End interaction
    if (annotationMode) {
        isDragging = false;
        activeMouseButton = null;
        return;
    }
    if (isVLMBboxMode) {
        // If VLM bbox was drawn (with valid size), process it
        if (vlmBboxStart && vlmBboxEnd) {
            const vlmBbox = {
                x: Math.min(vlmBboxStart.x, vlmBboxEnd.x),
                y: Math.min(vlmBboxStart.y, vlmBboxEnd.y),
                width: Math.abs(vlmBboxEnd.x - vlmBboxStart.x),
                height: Math.abs(vlmBboxEnd.y - vlmBboxStart.y)
            };
            if (vlmBbox.width > 1 && vlmBbox.height > 1) {
                // Auto-process VLM extraction
                cropAndExtractVLM(vlmBbox);
            }
        }
        // Reset VLM drawing state (but keep mode active)
        vlmBboxStart = null;
        vlmBboxEnd = null;
        isVLMDrawing = false;
        scheduleCrosshairOverlayDraw();
        scheduleDraw();
    } else if (isDrawingBbox) {
        // If bbox was drawn (with valid size), show modal
        if (currentBbox && currentBbox.width > 1 && currentBbox.height > 1) {
            showCropModal(currentBbox);
        }
        // Always reset drawing mode on mouseup to prevent stuck state
        isDrawingBbox = false;
        btnDrawBbox.textContent = UI_TEXT.DRAW_FIND;
        btnDrawBbox.classList.remove('active');
        canvasContainer.classList.remove('drawing-bbox'); // Reset cursor
        bboxStart = null;
        currentBbox = null;
        scheduleCrosshairOverlayDraw();
        scheduleDraw();
    }
    isDragging = false;
    activeMouseButton = null;
});
canvasContainer.addEventListener('mouseleave', () => {
    isDragging = false;
    activeMouseButton = null;
    setInteractionState(false); // End interaction when leaving canvas
    if (annotationMode && hoveredSnapPoint) {
        hoveredSnapPoint = null;
        scheduleDraw();
    }
    if (annotationMode === 'delete' && hoveredAnnotationId !== null) {
        hoveredAnnotationId = null;
        scheduleDraw();
    }
});
canvasContainer.addEventListener('mousemove', e => {
    const rect = canvasContainer.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left - offsetX) / zoom;
    const canvasY = (e.clientY - rect.top - offsetY) / zoom;
    mouseX = canvasX; mouseY = canvasY;
    if (isDragging) {
        setInteractionState(true); // Keep interaction active during pan
        offsetX += e.clientX - lastX;
        offsetY += e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        setInteractionState(false); // Signal end after movement (debounced)
        scheduleDraw();
    } else if (annotationMode) {
        updateHoveredSnapPoint();
        scheduleDraw();
    } else if (isVLMBboxMode) {
        vlmBboxEnd = { x: canvasX, y: canvasY };
        scheduleCrosshairOverlayDraw();
    } else if (isDrawingBbox) {
        if (bboxStart) {
            currentBbox = {
                x: Math.min(bboxStart.x, canvasX),
                y: Math.min(bboxStart.y, canvasY),
                width: Math.abs(canvasX - bboxStart.x),
                height: Math.abs(canvasY - bboxStart.y)
            };
        }
        scheduleCrosshairOverlayDraw();
    } else {
        if (shouldPreferShapeRasterPreview()) {
            if (hoveredGroup !== null) {
                hoveredGroup = null;
            }
            return;
        }
        // Hover detection for group highlight
        let hoveredSeqno = null;
        const tol = 15 / zoom;
        if (shapeQuadtree) {
            const hoverBuf = [];
            shapeQuadtree.query({
                minX: canvasX - tol,
                minY: canvasY - tol,
                maxX: canvasX + tol,
                maxY: canvasY + tol
            }, hoverBuf);
            for (let ni = 0; ni < hoverBuf.length; ni++) {
                const shape = hoverBuf[ni];
                if (!shape.color || !Array.isArray(shape.color) || shape.color.length < 3 ||
                    shape.color[0] !== 0 || shape.color[1] !== 0 || shape.color[2] !== 0) continue;
                if (!layerVisibility[shape.layer]) continue;
                for (let ii = 0; ii < shape.items.length; ii++) {
                    if (pointNearItem(canvasX, canvasY, { obj: shape, itemIndex: ii }, tol)) {
                        hoveredSeqno = shape.seqno || 0;
                        break;
                    }
                }
                if (hoveredSeqno !== null) break;
            }
        } else {
            for (const seqno in globalSeqnoToIds) {
                const ids = globalSeqnoToIds[seqno];
                let groupMatch = false;
                for (const id of ids) {
                    const [objIndex, itemIndex] = id.split('-').map(Number);
                    const obj = jsonShapes[objIndex];
                    if (obj.bbox) {
                        if (canvasX < obj.bbox.minX - tol || canvasX > obj.bbox.maxX + tol ||
                            canvasY < obj.bbox.minY - tol || canvasY > obj.bbox.maxY + tol) {
                            continue;
                        }
                    }
                    if (pointNearItem(canvasX, canvasY, { obj: obj, itemIndex: itemIndex }, tol)) {
                        hoveredSeqno = parseInt(seqno);
                        groupMatch = true;
                        break;
                    }
                }
                if (groupMatch) break;
            }
        }
        const newHoveredGroup = hoveredSeqno !== null ? seqnoGroups[hoveredSeqno] : null;
        if (newHoveredGroup !== hoveredGroup) {
            hoveredGroup = newHoveredGroup;
            scheduleDraw();
        }
    }
});
canvasContainer.addEventListener('wheel', e => {
    e.preventDefault();
    setInteractionState(true); // Start interaction
    const rect = canvasContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top;
    const worldX = (mouseX - offsetX) / zoom, worldY = (mouseY - offsetY) / zoom;
    const newZoom = e.deltaY < 0 ? zoom * CONFIG.ZOOM_STEP : zoom / CONFIG.ZOOM_STEP;
    offsetX = mouseX - worldX * newZoom;
    offsetY = mouseY - worldY * newZoom;
    zoom = newZoom;
    setInteractionState(false); // End interaction (debounced)
    scheduleDraw();
});
