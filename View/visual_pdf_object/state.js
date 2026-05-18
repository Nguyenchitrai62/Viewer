// state.js

// ============================================
// PERFORMANCE OPTIMIZATION: Interaction Mode
// ============================================
let isInteracting = false;
let interactionTimer = null;

function setInteractionState(active) {
    if (active) {
        isInteracting = true;
        if (interactionTimer) clearTimeout(interactionTimer);
        if (typeof cancelPendingVectorRender === 'function') {
            cancelPendingVectorRender();
        }
    } else {
        if (interactionTimer) clearTimeout(interactionTimer);
        interactionTimer = setTimeout(() => {
            isInteracting = false;
            scheduleDraw();
        }, CONFIG.INTERACTION_DEBOUNCE_MS || 80);
    }
}

const PAGE_GZIP_CACHE_TYPE = 'page-gzip-cache';

function normalizePageCachePageNum(pageNum) {
    const resolvedPageNum = Number(pageNum);
    return Number.isInteger(resolvedPageNum) && resolvedPageNum >= 1
        ? resolvedPageNum
        : null;
}

function createPageGzipCache(label = 'page-cache') {
    return {
        __type: PAGE_GZIP_CACHE_TYPE,
        label,
        entries: new Map()
    };
}

function isPageGzipCache(cache) {
    return Boolean(
        cache &&
        cache.__type === PAGE_GZIP_CACHE_TYPE &&
        cache.entries instanceof Map
    );
}

function getPageGzipCacheValue(cache, pageNum, { touch = true } = {}) {
    const resolvedPageNum = normalizePageCachePageNum(pageNum);
    if (!resolvedPageNum) {
        return null;
    }

    if (!isPageGzipCache(cache)) {
        const legacyValue = cache?.[resolvedPageNum];
        return typeof legacyValue === 'string' ? legacyValue : null;
    }

    const entry = cache.entries.get(resolvedPageNum);
    if (!entry) {
        return null;
    }

    if (touch) {
        cache.entries.delete(resolvedPageNum);
        cache.entries.set(resolvedPageNum, entry);
    }

    return entry;
}

function setPageGzipCacheValue(cache, pageNum, gzipData) {
    if (!isPageGzipCache(cache)) {
        return null;
    }

    const resolvedPageNum = normalizePageCachePageNum(pageNum);
    const resolvedValue = typeof gzipData === 'string' ? gzipData : '';
    if (!resolvedPageNum || !resolvedValue) {
        return null;
    }

    if (cache.entries.has(resolvedPageNum)) {
        cache.entries.delete(resolvedPageNum);
    }

    cache.entries.set(resolvedPageNum, resolvedValue);
    return {
        pageNum: resolvedPageNum,
        evictedPageNums: [],
    };
}

function clearPageGzipCache(cache) {
    if (!isPageGzipCache(cache)) {
        return createPageGzipCache();
    }

    cache.entries.clear();
    return cache;
}

function resetActivePageGzipCache() {
    cachedPages = createPageGzipCache('active-pages');
    return cachedPages;
}

function resetStagedPageGzipCache() {
    stagedCachedPages = createPageGzipCache('staged-pages');
    return stagedCachedPages;
}

function getPageGzipCacheKeys(cache) {
    if (isPageGzipCache(cache)) {
        return Array.from(cache.entries.keys());
    }

    return Object.keys(cache || {})
        .map(value => Number(value))
        .filter(value => Number.isInteger(value) && value >= 1);
}

const canvas = document.getElementById('drawing-canvas');
const ctx = canvas.getContext('2d');
const shapeRasterLayer = document.getElementById('shape-raster-layer');
const crosshairCanvas = document.getElementById('crosshair-canvas');
const crosshairCtx = crosshairCanvas.getContext('2d');
const vlmScreenFlash = document.getElementById('vlm-screen-flash');
const vlmSelectionFrame = document.getElementById('vlm-selection-frame');
const zoomIndicator = document.getElementById('zoom-indicator');
const dropZone = document.getElementById('drop-zone');
const layerList = document.getElementById('layer-list');
const btnShowMainLayer = document.getElementById('btn-show-main-layer');
const canvasContainer = document.getElementById('canvas-container');
const btnDrawBbox = document.getElementById('btn-draw-rect');
const btnResetFilter = document.getElementById('btn-reset-filter');
const btnExportSvg = document.getElementById('btn-export-svg');
const btnDetectPipeline = document.getElementById('btn-detect-pipeline');
const btnExportPipelineJson = document.getElementById('btn-export-pipeline-json');
const btnExportRevitJson = document.getElementById('btn-export-revit-json');
const btnToggleLayerMode = document.getElementById('btn-toggle-layer-mode');
const btnAIExtract = document.getElementById('btn-ai-extract');
const btnLabelJunction = document.getElementById('btn-label-junction');
const btnLabelConnect = document.getElementById('btn-label-connect');
const btnCheckConnectPair = document.getElementById('btn-check-connect-pair');
const btnUndoLabel = document.getElementById('btn-undo-label');
const btnClearLabels = document.getElementById('btn-clear-labels');
const btnExportLabelPackage = document.getElementById('btn-export-label-package');
const manualLabelPanel = document.getElementById('manual-label-panel');
const btnToggleManualLabelPanel = document.getElementById('btn-toggle-manual-label-panel');
const manualLabelCountBadge = document.getElementById('manual-label-count-badge');
const manualLabelStatus = document.getElementById('manual-label-status');
let isManualLabelPanelCollapsed = true;

let jsonData = null;
let jsonShapes = null;
let documentMetadata = null;
let currentJsonSourceFile = null;
let currentJsonGzipPromise = null;
let currentLayerField = 'layer_1';
let svgData = null;
let pipelineRawResults = null;
let layerIndex = {};
let layerVisibility = {};
let sortedLayerKeys = [];
let totalCommands = {};
let currentPdfFile = null;
let zoom = CONFIG.INITIAL_ZOOM;
let min_zoom = CONFIG.INITIAL_ZOOM;
let offsetX = 0, offsetY = 0;
let isDragging = false;
let activeMouseButton = null;
let lastX = 0, lastY = 0;
let isDrawingBbox = false;
let isApplyingSavedPattern = false;
let bboxStart = null;
let currentBbox = null;
let mouseX = 0, mouseY = 0;

let isVLMBboxMode = false;
let vlmBboxStart = null;
let vlmBboxEnd = null;
let isVLMDrawing = false;
let cropLengths = null;
let cropLengthsFull = null;
let cropLengthsFiltered = null;
let mainLayers = null;
let mainLayerClassificationDocumentKey = null;
let mainLayerClassificationCache = new Map();
let mainLayerClassificationRequestToken = 0;
let anchorBbox = null;
let cropPreviewBbox = null;
let isCropModalOpen = false;
let allShapesSorted = [];
let allShapesBounds = null;
let similarBboxes = [];
let sequenceMatches = [];
let sequencePatternTokens = null;
let lastSequenceSearchMs = 0;
let searchBboxSize = null;
let expandedNodes = {};
let anchorPatterns = [];
let rawAnchorPatternCount = 0;
let lastSearchMs = 0;
let precomputedLengths = {};
let drawScheduled = false;
let currentPageNum = null;
let pendingVLMCrop = null;
let pendingVLMBbox = null;
let vlmSelectionUiState = null;
let vlmSnapTimer = null;
let activeVlmCropRequestId = 0;
let cachedPageImage = null;
let cachedPageImageLoading = false;
let cachedPageImagePageNum = null;
let cachedPageImageScale = null;
let cachedPageImagePromise = null;
let cachedPageImageRequestedPageNum = null;
let currentPdfDocument = null;
let currentPdfDocumentPromise = null;
let currentPdfDocumentSourceKey = null;
let currentPdfDocumentObjectUrl = null;
let pdfRasterPreviewPages = {};
let pdfRasterPreviewLoadingPages = {};
let pipelineLayerNames = [];
let detectionRawResults = null;
let detectionAdjustedResults = null;
let detectionLayerNames = [];
let annotationMode = null;
let pendingConnectPoint = null;
let hoveredSnapPoint = null;
let manualAnnotations = [];
let manualAnnotationId = 0;
let manualAnnotationHistory = [];
let snapPoints = [];
let snapPointQuadtree = null;
let snapPointLineCandidates = new Map();
let snapPointLineItems = new Map();
let snapPointLineItemsByLayer = new Map();
let snapPointLineQuadtreesByLayer = new Map();
let snapPointIndexReady = false;
let snapPointIndexBuildPromise = null;
let snapPointIndexBuildToken = 0;
let snapPointIndexWarmupHandle = null;
let snapPointIndexWarmupUsesIdleCallback = false;
let annotationFeedbackMessage = '';
let annotationFeedbackTone = 'info';
let hoveredAnnotationId = null;
let suggestedConnectAnnotations = [];
let manualSuggestionRequestId = 0;
let manualAnnotationSpatialIndex = null;
let manualAnnotationSpatialIndexReady = false;
let pairCheckSelectionIds = [];
let pairCheckLastReport = null;
let extractedCellOverlays = [];
let extractedCellDownloadBundle = null;

const KELLY_COLORS = [
    '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
    '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe',
    '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000',
    '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080'
];

const PIPELINE_SHAPE_COLORS = {
    'Line': null,
    'Tee': [1.0, 0.0, 1.0],
    'Elbow': [0.0, 1.0, 1.0],
    'Cross': [1.0, 1.0, 0.0],
    'Reducer': [1.0, 0.5, 0.0],
    'Sprinkler': null
};
let cropItems = [];
let cropSelectedItemIds = new Set();
let cropPreviewTransform = null;
let cropPreviewObjects = [];
let cropPreviewItemLookup = null;
let activeCropModalRequestId = 0;
let findPopupPageCache = null;
let findPopupPageCacheBuildPromise = null;
let findPopupPageCacheBuildToken = 0;
let findPopupPageCacheWarmScheduled = false;
let selectionMode = 'hide';
let dragSelecting = false;
let cachedPages = createPageGzipCache('active-pages');
let currentThumbnailTaskId = 0;
let selectedThumbnailPageNum = null;
let waitingPageNum = null;
let pageLoadRequestId = 0;
let activePageLoadCount = 0;
let pdfPageProcessingState = {};
let pageThumbnailRefs = {};
let currentBatchTaskId = 0;
let currentBatchAbortController = null;
let autoOpenReadyPage = false;
let stagedPdfFile = null;
let stagedCachedPages = createPageGzipCache('staged-pages');
let currentPdfUploadSession = null;
let currentPdfUploadPromise = null;
let currentPdfUploadPromiseSourceKey = null;
let currentThumbnailWarmupTaskId = 0;
let currentThumbnailWarmupSourceKey = null;
let currentUploadController = null;
let currentUploadControllerSourceKey = null;
let currentUploadSocket = null;

const lengthCache = new WeakMap();

let shapesDrawBuffer = [];

let globalSeqnoToIds = {};
let cropSeqnoToIds = {};
let seqnoEndpoints = {};

let seqnoToLayer = {};
let seqnoGroups = {};
let groupToSeqnos = {};
let hoveredGroup = null;
let seqnoHoverIndexReady = false;
const icons = {
    text: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M5 4h14v2H5V4zm7 3L8.5 17h2l1-3h1l1 3h2L12 7zm-1 5l1.5-4.5L14 12h-3z"></path></svg>',
    shape: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>',
    filled: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h18v18H3V3z"></path></svg>'
};

const UI_TEXT = Object.freeze({
    DRAW_FIND: '✏️ Find',
    VLM_EXTRACT: '🤖 AI',
    VLM_SHORT: '🤖 AI',
    CANCEL: 'Cancel',
    MODE_FIND: '🔍 Tìm kiếm',
    MODE_SYMBOL: '🏷️ Symbol',
    MODE_JUNCTION: '● Junction',
    MODE_CONNECT: '↔ Connect',
    MODE_PAIR_CHECK: '⇄ Pair Check',
    MODE_DELETE: '⌦ Delete',
    TREE_EXPANDED: ' ▼',
    TREE_COLLAPSED: ' ▶',
    EDIT_ICON: '✏️',
    TRASH_ICON: '🗑️',
    CLOSE_GLYPH: '✕',
    BULLET_SEPARATOR: ' • ',
    EN_DASH_SEPARATOR: ' – '
});
