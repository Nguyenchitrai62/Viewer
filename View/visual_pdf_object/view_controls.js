// view_controls.js

function setupVisualization() {
    canvas.style.background = 'white';
    if (!jsonShapes) {
        layerVisibility = {};
        sortedLayerKeys = [];
        dropZone.classList.remove('hidden');
        return;
    }
    layerVisibility = {};
    sortedLayerKeys = Object.keys(layerIndex).sort((a, b) => totalCommands[b] - totalCommands[a]);
    sortedLayerKeys.forEach(layerName => layerVisibility[layerName] = true);
    if (svgData) {
        sortedLayerKeys.push('svg_graphic', 'svg_text');
        layerVisibility['svg_graphic'] = true;
        layerVisibility['svg_text'] = true;
        const textLayer = document.getElementById('svg-text-layer');
        const graphicLayer = document.getElementById('svg-graphic-layer');
        textLayer.innerHTML = svgData.text_only || '';
        graphicLayer.innerHTML = svgData.graphic_only || '';
        applySvgTransform();
    }
    expandedNodes = {};
    updateLayerList();
    if (typeof scheduleShapeRasterCacheBuild === 'function') {
        scheduleShapeRasterCacheBuild();
    }
    resetView();
}

function resizeCanvas() {
    canvas.width = canvasContainer.clientWidth;
    canvas.height = canvasContainer.clientHeight;
    crosshairCanvas.width = canvasContainer.clientWidth;
    crosshairCanvas.height = canvasContainer.clientHeight;
    if (typeof cancelPendingVectorRender === 'function') {
        cancelPendingVectorRender();
    }
    scheduleDraw();
}

function resetView() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasBounds = false;

    const visibleShapes = (allShapesSorted && allShapesSorted.length > 0) ? allShapesSorted : (jsonShapes || []);

    if (visibleShapes && visibleShapes.length > 0) {
        visibleShapes.forEach(obj => {
            if (obj.bbox) {
                minX = Math.min(minX, obj.bbox.minX);
                minY = Math.min(minY, obj.bbox.minY);
                maxX = Math.max(maxX, obj.bbox.maxX);
                maxY = Math.max(maxY, obj.bbox.maxY);
                hasBounds = true;
            } else if (obj.rect) {
                minX = Math.min(minX, obj.rect[0]);
                minY = Math.min(minY, obj.rect[1]);
                maxX = Math.max(maxX, obj.rect[2]);
                maxY = Math.max(maxY, obj.rect[3]);
                hasBounds = true;
            }
        });
    }

    if (!hasBounds && documentMetadata && documentMetadata.bbox_all) {
        [minX, minY, maxX, maxY] = documentMetadata.bbox_all;
        hasBounds = true;
    }

    if (!hasBounds && svgData) {
        const textSvg = svgData.text_only || '';
        const graphicSvg = svgData.graphic_only || '';
        const svgBounds = extractSvgViewBoxBounds(textSvg) || extractSvgViewBoxBounds(graphicSvg);
        if (svgBounds) {
            minX = svgBounds.minX;
            minY = svgBounds.minY;
            maxX = svgBounds.maxX;
            maxY = svgBounds.maxY;
            hasBounds = true;
        }
    }

    if (!hasBounds) {
        offsetX = canvas.width / 2;
        offsetY = canvas.height / 2;
        zoom = 1;
        scheduleDraw();
        return;
    }

    const contentWidth = maxX - minX, contentHeight = maxY - minY;
    zoom = Math.min(canvas.width / contentWidth, canvas.height / contentHeight) * CONFIG.ZOOM_FIT_MARGIN;
    offsetX = canvas.width / 2 - (minX + contentWidth / 2) * zoom;
    offsetY = canvas.height / 2 - (minY + contentHeight / 2) * zoom;
    scheduleDraw();
}

function clearVisualization() {
    if (typeof interactionTimer !== 'undefined' && interactionTimer) {
        clearTimeout(interactionTimer);
        interactionTimer = null;
    }
    if (typeof cancelPendingVectorRender === 'function') {
        cancelPendingVectorRender();
    }

    if (typeof invalidateShapeRasterCache === 'function') {
        invalidateShapeRasterCache();
    }
    if (typeof hideShapeRasterPreview === 'function') {
        hideShapeRasterPreview();
    }
    if (typeof resetZoomIndicator === 'function') {
        resetZoomIndicator();
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Clear SVG layers
    document.getElementById('svg-text-layer').innerHTML = '';
    document.getElementById('svg-graphic-layer').innerHTML = '';

    // Reset data
    jsonData = null;
    jsonShapes = null;
    documentMetadata = null;
    svgData = null;
    currentJsonSourceFile = null;
    currentJsonGzipPromise = null;
    layerIndex = {};
    layerVisibility = {};
    sortedLayerKeys = [];
    totalCommands = {};
    allShapesSorted = [];
    shapeQuadtree = null;
    _perLayerBounds = {};
    precomputedLengths = {}; // Clear stale length cache to avoid wrong matches on new page
    pipelineRawResults = null;
    pipelineLayerNames = [];

    cachedPageImage = null;
    cachedPageImageLoading = false;
    cachedPageImagePageNum = null;
    cachedPageImageScale = null;
    cachedPageImagePromise = null;
    cachedPageImageRequestedPageNum = null;

    // Clear layer list
    layerList.innerHTML = '';

    // Show drop zone if hidden
    dropZone.classList.remove('hidden');

    // Reset zoom and offset
    zoom = CONFIG.INITIAL_ZOOM;
    offsetX = 0;
    offsetY = 0;

    // Clear crop data and search state
    cropLengths = null;
    cropLengthsFull = null;
    cropLengthsFiltered = null;
    mainLayers = null;
    anchorBbox = null;
    anchorPatterns = null; // Reset anchor patterns
    similarBboxes = [];
    sequenceMatches = []; // Reset sequence matches
    sequencePatternTokens = null; // Reset sequence tokens
    searchBboxSize = null;
    cropItems = [];
    cropSelectedItemIds.clear();
    expandedNodes = {};

    // Reset transient UI modes so button labels/icons stay in sync after a reload.
    isDrawingBbox = false;
    isApplyingSavedPattern = false;
    bboxStart = null;
    currentBbox = null;
    isVLMBboxMode = false;
    vlmBboxStart = null;
    vlmBboxEnd = null;
    isVLMDrawing = false;
    if (typeof pendingVLMCrop !== 'undefined') {
        pendingVLMCrop = null;
    }
    if (typeof pendingVLMBbox !== 'undefined') {
        pendingVLMBbox = null;
    }
    if (typeof extractedCellOverlays !== 'undefined') {
        extractedCellOverlays = [];
    }
    if (typeof extractedCellDownloadBundle !== 'undefined') {
        extractedCellDownloadBundle = null;
    }
    if (typeof syncExtractedCellDownloadButton === 'function') {
        syncExtractedCellDownloadButton();
    }
    btnDrawBbox.textContent = UI_TEXT.DRAW_FIND;
    btnDrawBbox.classList.remove('active');
    btnVLMExtract.textContent = UI_TEXT.VLM_EXTRACT;
    btnVLMExtract.classList.remove('active');
    annotationMode = null;
    pendingConnectPoint = null;
    hoveredSnapPoint = null;
    manualAnnotations = [];
    manualAnnotationId = 0;
    manualAnnotationHistory = [];
    snapPoints = [];
    snapPointQuadtree = null;
    annotationFeedbackMessage = '';
    annotationFeedbackTone = 'info';
    hoveredAnnotationId = null;
    canvasContainer.classList.remove('drawing-bbox', 'vlm-bbox-mode', 'annotation-junction-mode', 'annotation-connect-mode', 'annotation-delete-mode');
    crosshairCtx.clearRect(0, 0, crosshairCanvas.width, crosshairCanvas.height);
    if (typeof updateModeLabel === 'function') {
        updateModeLabel(null);
    }
    if (typeof updateManualLabelUI === 'function') {
        updateManualLabelUI();
    }

    // Clear search info
    document.getElementById('found-count').style.display = 'none';

    // Clear seqno mapping
    globalSeqnoToIds = {};
    cropSeqnoToIds = {};
    seqnoToLayer = {};
    seqnoGroups = {};
    groupToSeqnos = {};

    // Clear selected thumbnail
    document.querySelectorAll('.page-thumbnail').forEach(thumb => thumb.classList.remove('selected'));
}
