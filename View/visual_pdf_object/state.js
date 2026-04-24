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
        }, 300);
    }
}

const canvas = document.getElementById('drawing-canvas');
const ctx = canvas.getContext('2d');
const shapeRasterLayer = document.getElementById('shape-raster-layer');
const crosshairCanvas = document.getElementById('crosshair-canvas');
const crosshairCtx = crosshairCanvas.getContext('2d');
const zoomIndicator = document.getElementById('zoom-indicator');
const dropZone = document.getElementById('drop-zone');
const layerList = document.getElementById('layer-list');
const canvasContainer = document.getElementById('canvas-container');
const btnDrawBbox = document.getElementById('btn-draw-rect');
const btnResetFilter = document.getElementById('btn-reset-filter');
const btnExportSvg = document.getElementById('btn-export-svg');
const btnDetectPipeline = document.getElementById('btn-detect-pipeline');
const btnExportPipelineJson = document.getElementById('btn-export-pipeline-json');
const btnExportRevitJson = document.getElementById('btn-export-revit-json');
const btnToggleLayerMode = document.getElementById('btn-toggle-layer-mode');
const btnVLMExtract = document.getElementById('btn-vlm-extract');
const btnLabelJunction = document.getElementById('btn-label-junction');
const btnLabelConnect = document.getElementById('btn-label-connect');
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
let anchorBbox = null;
let cropPreviewBbox = null;
let allShapesSorted = [];
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
let cachedPageImage = null;
let cachedPageImageLoading = false;
let cachedPageImagePageNum = null;
let cachedPageImageScale = null;
let cachedPageImagePromise = null;
let cachedPageImageRequestedPageNum = null;
let currentPdfDocument = null;
let currentPdfDocumentPromise = null;
let currentPdfDocumentSourceKey = null;
let pdfRasterPreviewPages = {};
let pdfRasterPreviewLoadingPages = {};
let pipelineLayerNames = [];
let annotationMode = null;
let pendingConnectPoint = null;
let hoveredSnapPoint = null;
let manualAnnotations = [];
let manualAnnotationId = 0;
let manualAnnotationHistory = [];
let snapPoints = [];
let snapPointQuadtree = null;
let annotationFeedbackMessage = '';
let annotationFeedbackTone = 'info';
let hoveredAnnotationId = null;

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
let selectionMode = 'hide';
let dragSelecting = false;
let cachedPages = {};
let currentThumbnailTaskId = 0;

const lengthCache = new WeakMap();

let shapesDrawBuffer = [];

let globalSeqnoToIds = {};
let cropSeqnoToIds = {};

let seqnoToLayer = {};
let seqnoGroups = {};
let groupToSeqnos = {};
let hoveredGroup = null;
const icons = {
    text: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M5 4h14v2H5V4zm7 3L8.5 17h2l1-3h1l1 3h2L12 7zm-1 5l1.5-4.5L14 12h-3z"></path></svg>',
    shape: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>',
    filled: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h18v18H3V3z"></path></svg>'
};

const UI_TEXT = Object.freeze({
    DRAW_FIND: '✏️ Find',
    VLM_EXTRACT: '🤖 VLM Extract',
    VLM_SHORT: '🤖 VLM',
    CANCEL: 'Cancel',
    MODE_FIND: '🔍 Tìm kiếm',
    MODE_JUNCTION: '● Junction',
    MODE_CONNECT: '↔ Connect',
    MODE_DELETE: '⌦ Delete',
    TREE_EXPANDED: ' ▼',
    TREE_COLLAPSED: ' ▶',
    EDIT_ICON: '✏️',
    TRASH_ICON: '🗑️',
    CLOSE_GLYPH: '✕',
    BULLET_SEPARATOR: ' • ',
    EN_DASH_SEPARATOR: ' – '
});
