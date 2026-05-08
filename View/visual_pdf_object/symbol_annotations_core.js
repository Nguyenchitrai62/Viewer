const symbolAnnotationPanel = document.getElementById('symbol-annotation-panel');
const btnToggleSymbolAnnotationPanel = document.getElementById('btn-toggle-symbol-annotation-panel');
const symbolAnnotationCountBadge = document.getElementById('symbol-annotation-count-badge');
const symbolAnnotationSaveBadge = document.getElementById('symbol-annotation-save-badge');
const symbolAnnotationLoadingMask = document.getElementById('symbol-annotation-loading-mask');
const symbolAnnotationLoadingText = document.getElementById('symbol-annotation-loading-text');
const symbolLabelNameInput = document.getElementById('symbol-label-name-input');
const btnAddSymbolLabel = document.getElementById('btn-add-symbol-label');
const symbolLabelList = document.getElementById('symbol-label-list');
const btnSymbolDrawMatch = document.getElementById('btn-symbol-draw-match');
const btnSymbolAutoFindPage = document.getElementById('btn-symbol-auto-find-page');
const btnSymbolExportDataset = document.getElementById('btn-symbol-export-dataset');
const btnSymbolDeleteByBbox = document.getElementById('btn-symbol-delete-by-bbox');
const btnSymbolSavePage = document.getElementById('btn-symbol-save-page');
const btnSymbolReloadPage = document.getElementById('btn-symbol-reload-page');
const btnSymbolClearPage = document.getElementById('btn-symbol-clear-page');
const symbolAnnotationStatus = document.getElementById('symbol-annotation-status');
const symbolSimilarityThresholdInput = document.getElementById('symbol-similarity-threshold');
const symbolSimilarityThresholdValue = document.getElementById('symbol-similarity-threshold-value');

let symbolLabelDefinitions = [];
let selectedSymbolLabelId = null;
let symbolAnnotations = [];
let symbolAnnotationId = 0;
let isSymbolFindArmed = false;
let isSymbolDeleteArmed = false;
let isSymbolAnnotationPanelCollapsed = false;
let symbolAnnotationFeedbackMessage = '';
let symbolAnnotationFeedbackTone = 'info';
let symbolAnnotationLoadRequestId = 0;
let symbolAnnotationActivePageKey = '';
let symbolAnnotationPageCache = new Map();
let symbolAnnotationCacheDocumentKey = '';
let symbolAnnotationPendingPageLoads = new Map();
let symbolAnnotationDirtyPageKeys = new Set();
let symbolAnnotationPendingSaveKeys = new Set();
let symbolAnnotationQueuedSaveKeys = new Set();
let symbolAnnotationPageRevisions = new Map();
let symbolAnnotationKnownEmptyPageKeys = new Set();
let symbolAnnotationDocumentLabels = [];
let symbolAnnotationDocumentSummary = null;
let symbolAnnotationDocumentSummaryKey = '';
let symbolAnnotationDocumentSummaryPromise = null;
let symbolAnnotationPendingDocumentSave = null;
let symbolAnnotationQueuedDocumentSave = false;
let symbolAnnotationIsLoading = false;
let symbolAnnotationLoadingMessage = 'Đang tải annotation...';
let symbolAnnotationLoadAbortController = null;
let symbolAnnotationExportInProgress = false;
let symbolAnnotationAutoFindInProgress = false;

const SYMBOL_ANNOTATION_PAGE_CACHE_LIMIT = 0;
const SYMBOL_SIMILARITY_THRESHOLD_STORAGE_KEY = 'visual_pdf_object.symbol_annotation_similarity_threshold';
const SYMBOL_SIMILARITY_THRESHOLD_MIN = 50;
const SYMBOL_SIMILARITY_THRESHOLD_MAX = 100;
const SYMBOL_SIMILARITY_THRESHOLD_STEP = 5;
const SYMBOL_LABEL_COLOR_PALETTE = [
    '#e11d48',
    '#2563eb',
    '#16a34a',
    '#ea580c',
    '#0891b2',
    '#7c3aed',
    '#ca8a04',
    '#dc2626',
    '#0f766e',
    '#9333ea',
    '#1d4ed8',
    '#be123c'
];

function clampSymbolSimilarityThreshold(value) {
    const fallbackValue = Math.round(((CONFIG?.SIMILARITY_THRESHOLD_GREEN ?? 0.6) * 100) / SYMBOL_SIMILARITY_THRESHOLD_STEP) * SYMBOL_SIMILARITY_THRESHOLD_STEP;
    if (value === null || value === undefined || value === '') {
        return Math.max(SYMBOL_SIMILARITY_THRESHOLD_MIN, Math.min(SYMBOL_SIMILARITY_THRESHOLD_MAX, fallbackValue));
    }
    const numericValue = Number(value);
    const resolvedValue = Number.isFinite(numericValue) ? numericValue : fallbackValue;
    const steppedValue = Math.round(resolvedValue / SYMBOL_SIMILARITY_THRESHOLD_STEP) * SYMBOL_SIMILARITY_THRESHOLD_STEP;
    return Math.max(SYMBOL_SIMILARITY_THRESHOLD_MIN, Math.min(SYMBOL_SIMILARITY_THRESHOLD_MAX, steppedValue));
}

function loadStoredSymbolSimilarityThreshold() {
    try {
        return clampSymbolSimilarityThreshold(localStorage.getItem(SYMBOL_SIMILARITY_THRESHOLD_STORAGE_KEY));
    } catch (error) {
        return clampSymbolSimilarityThreshold(null);
    }
}

let symbolAnnotationSimilarityThreshold = loadStoredSymbolSimilarityThreshold();

function normalizeSymbolDocumentName(name) {
    const rawName = String(name || '').trim();
    if (!rawName) return '';
    const normalizedPath = rawName.replace(/\\/g, '/').split('?')[0].split('#')[0];
    return String(normalizedPath.split('/').pop() || rawName).trim();
}

function getCurrentSymbolDocumentName() {
    const sourceName = (currentPdfFile && currentPdfFile.name)
        || (currentJsonSourceFile && (currentJsonSourceFile.name || currentJsonSourceFile))
        || '';
    return normalizeSymbolDocumentName(sourceName);
}

function getCurrentSymbolDocumentCacheKey() {
    const source = currentPdfFile || currentJsonSourceFile || null;
    const sourceName = getCurrentSymbolDocumentName();
    if (!sourceName) return '';

    if (source && typeof source === 'object') {
        const size = Number.isFinite(Number(source.size)) ? Number(source.size) : 0;
        const lastModified = Number.isFinite(Number(source.lastModified)) ? Number(source.lastModified) : 0;
        return `${sourceName}::${size}::${lastModified}`;
    }

    return sourceName;
}

function clearSymbolAnnotationPageCache() {
    symbolAnnotationPageCache = new Map();
    symbolAnnotationPendingPageLoads = new Map();
    symbolAnnotationDirtyPageKeys = new Set();
    symbolAnnotationPageRevisions = new Map();
    symbolAnnotationKnownEmptyPageKeys = new Set();
}

function clearSymbolAnnotationDocumentState() {
    symbolAnnotationDocumentLabels = [];
    symbolAnnotationDocumentSummary = null;
    symbolAnnotationDocumentSummaryKey = '';
    symbolAnnotationDocumentSummaryPromise = null;
    symbolAnnotationPendingDocumentSave = null;
    symbolAnnotationQueuedDocumentSave = false;
}

function syncSymbolAnnotationCacheDocument() {
    const nextDocumentKey = getCurrentSymbolDocumentCacheKey();
    if (!nextDocumentKey) {
        return;
    }
    if (symbolAnnotationCacheDocumentKey && symbolAnnotationCacheDocumentKey === nextDocumentKey) {
        return;
    }
    clearSymbolAnnotationPageCache();
    clearSymbolAnnotationDocumentState();
    symbolAnnotationCacheDocumentKey = nextDocumentKey;
}

function getSymbolPageKey(pdfName = getCurrentSymbolDocumentName(), pageNum = currentPageNum) {
    const normalizedName = normalizeSymbolDocumentName(pdfName);
    const resolvedPageNum = Number(pageNum);
    if (!normalizedName || !Number.isFinite(resolvedPageNum) || resolvedPageNum < 1) {
        return '';
    }
    return `${normalizedName}::${resolvedPageNum}`;
}

function parseSymbolPageKey(pageKey) {
    const separatorIndex = String(pageKey || '').lastIndexOf('::');
    if (separatorIndex <= 0) return null;
    const pdfName = String(pageKey).slice(0, separatorIndex);
    const pageNum = Number(String(pageKey).slice(separatorIndex + 2));
    if (!pdfName || !Number.isFinite(pageNum) || pageNum < 1) return null;
    return { pdfName, pageNum };
}

function buildEmptySymbolAnnotationClientPayload(pdfName, pageNum) {
    return {
        pdf_name: normalizeSymbolDocumentName(pdfName),
        page_num: Number(pageNum),
        page_bounds: null,
        labels: getSymbolAnnotationPayloadLabels().map(serializeSymbolLabelDefinition),
        annotations: [],
        annotation_count: 0,
        storage_backend: 'session-cache'
    };
}

function slugifySymbolLabelName(name) {
    return String(name || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        || 'symbol';
}

function normalizeSymbolVectorPattern(pattern) {
    const clonedPattern = cloneSymbolAnnotationPayload(pattern);
    if (!clonedPattern || typeof clonedPattern !== 'object' || !clonedPattern.data) {
        return null;
    }
    const data = clonedPattern.data;
    if (!data.cropLengths || !data.searchBboxSize) {
        return null;
    }
    clonedPattern.thumbnail = '';
    return clonedPattern;
}

function resolveSymbolClassId(value, fallbackValue = 0) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallbackValue;
}

function normalizeSymbolLabelDefinition(rawLabel, fallbackClassId = null) {
    if (!rawLabel) return null;
    const labelName = String(rawLabel.name || rawLabel.label_name || '').trim();
    if (!labelName) return null;

    const slug = rawLabel.slug || rawLabel.label_slug || slugifySymbolLabelName(labelName);
    const rawClassId = rawLabel.classId ?? rawLabel.class_id ?? rawLabel.exportClassId;
    const classId = Number.isFinite(Number(rawClassId))
        ? Number(rawClassId)
        : resolveSymbolClassId(fallbackClassId, getNextSymbolClassId());
    const labelId = rawLabel.id || rawLabel.label_id || `symbol_label_${slug}_${classId}`;
    const vectorPattern = normalizeSymbolVectorPattern(rawLabel.vectorPattern || rawLabel.vector_pattern);
    const rawAnnotationCount = rawLabel.documentAnnotationCount ?? rawLabel.annotationCount ?? rawLabel.annotation_count;
    const documentAnnotationCount = Number.isFinite(Number(rawAnnotationCount))
        ? Math.max(0, Number(rawAnnotationCount))
        : null;

    return {
        id: String(labelId),
        name: labelName,
        slug,
        classId,
        color: isSupportedSymbolColor(rawLabel.color) ? rawLabel.color : null,
        vectorPattern,
        documentAnnotationCount
    };
}

function mergeSymbolLabelDefinitionLists(...labelLists) {
    const mergedBySlug = new Map();

    labelLists.flat().forEach((rawLabel, index) => {
        const normalizedLabel = normalizeSymbolLabelDefinition(rawLabel, index);
        if (!normalizedLabel) return;
        const existingLabel = mergedBySlug.get(normalizedLabel.slug);
        if (!existingLabel) {
            mergedBySlug.set(normalizedLabel.slug, normalizedLabel);
            return;
        }

        mergedBySlug.set(normalizedLabel.slug, {
            ...existingLabel,
            id: existingLabel.id || normalizedLabel.id,
            name: existingLabel.name || normalizedLabel.name,
            classId: Number.isFinite(Number(existingLabel.classId)) ? existingLabel.classId : normalizedLabel.classId,
            color: isSupportedSymbolColor(existingLabel.color) ? existingLabel.color : normalizedLabel.color,
            vectorPattern: existingLabel.vectorPattern || normalizedLabel.vectorPattern,
            documentAnnotationCount: Number.isFinite(Number(existingLabel.documentAnnotationCount)) && Number.isFinite(Number(normalizedLabel.documentAnnotationCount))
                ? Math.max(Number(existingLabel.documentAnnotationCount), Number(normalizedLabel.documentAnnotationCount))
                : (Number.isFinite(Number(existingLabel.documentAnnotationCount))
                    ? Number(existingLabel.documentAnnotationCount)
                    : normalizedLabel.documentAnnotationCount)
        });
    });

    return ensureDistinctSymbolLabelColors(sortSymbolLabelDefinitions(Array.from(mergedBySlug.values())));
}

function setSymbolAnnotationDocumentLabels(labels = []) {
    symbolAnnotationDocumentLabels = mergeSymbolLabelDefinitionLists(symbolAnnotationDocumentLabels, labels);
    symbolLabelDefinitions = mergeSymbolLabelDefinitionLists(symbolAnnotationDocumentLabels, symbolLabelDefinitions);
}

function getActiveSymbolAnnotationLabelDefinitions() {
    return (symbolAnnotations || []).map(annotation => ({
        label_id: annotation.labelId,
        name: annotation.labelName,
        slug: annotation.labelSlug,
        class_id: annotation.classId,
        color: resolveSymbolAnnotationColor(annotation)
    }));
}

function replaceSymbolAnnotationDocumentLabels(labels = []) {
    const normalizedLabels = (Array.isArray(labels) ? labels : [])
        .map((label, index) => normalizeSymbolLabelDefinition(label, index))
        .filter(Boolean);
    symbolAnnotationDocumentLabels = ensureDistinctSymbolLabelColors(sortSymbolLabelDefinitions(normalizedLabels));
    symbolLabelDefinitions = mergeSymbolLabelDefinitionLists(
        symbolAnnotationDocumentLabels,
        getActiveSymbolAnnotationLabelDefinitions()
    );
    if (selectedSymbolLabelId && !symbolLabelDefinitions.some(label => label.id === selectedSymbolLabelId)) {
        selectedSymbolLabelId = null;
    }
}

function getSymbolAnnotationPayloadLabels() {
    const annotationLabels = (symbolAnnotations || []).map(annotation => ({
        id: annotation.labelId,
        name: annotation.labelName,
        slug: annotation.labelSlug,
        classId: annotation.classId,
        color: resolveSymbolAnnotationColor(annotation)
    }));
    const labels = mergeSymbolLabelDefinitionLists(symbolAnnotationDocumentLabels, symbolLabelDefinitions, annotationLabels);
    symbolAnnotationDocumentLabels = mergeSymbolLabelDefinitionLists(symbolAnnotationDocumentLabels, labels);
    symbolLabelDefinitions = labels;
    return labels;
}

function serializeSymbolLabelDefinition(label) {
    return {
        label_id: label.id,
        name: label.name,
        slug: label.slug,
        class_id: label.classId,
        color: label.color,
        vector_pattern: normalizeSymbolVectorPattern(label.vectorPattern)
    };
}

function getSymbolLabelsWithVectorPatterns() {
    return mergeSymbolLabelDefinitionLists(symbolAnnotationDocumentLabels, symbolLabelDefinitions)
        .filter(label => normalizeSymbolVectorPattern(label.vectorPattern));
}

function removeSymbolLabelFromCachedPages(label) {
    const currentDocumentName = getCurrentSymbolDocumentName();
    if (!label?.slug || !currentDocumentName) {
        return;
    }

    for (const [pageKey, cacheEntry] of Array.from(symbolAnnotationPageCache.entries())) {
        const parsedPage = parseSymbolPageKey(pageKey);
        if (!parsedPage || parsedPage.pdfName !== currentDocumentName) {
            continue;
        }

        const clonedPayload = cloneSymbolAnnotationPayload(cacheEntry?.payload);
        if (!clonedPayload) {
            continue;
        }

        clonedPayload.labels = (clonedPayload.labels || []).filter(candidate => {
            const candidateId = candidate?.id || candidate?.label_id;
            const candidateName = candidate?.name || candidate?.label_name;
            const candidateSlug = candidate?.slug || candidate?.label_slug;
            return candidateSlug !== label.slug && candidateId !== label.id && candidateName !== label.name;
        });

        clonedPayload.annotations = (clonedPayload.annotations || []).filter(candidate => {
            const candidateId = candidate?.label_id || candidate?.labelId;
            const candidateName = candidate?.label_name || candidate?.labelName;
            const candidateSlug = candidate?.label_slug || candidate?.labelSlug;
            return candidateSlug !== label.slug && candidateId !== label.id && candidateName !== label.name;
        });

        const annotationCount = Array.isArray(clonedPayload.annotations) ? clonedPayload.annotations.length : 0;
        clonedPayload.annotation_count = annotationCount;
        cacheSymbolAnnotationPagePayload(pageKey, clonedPayload, { clonePayload: false, returnClone: false });
        if (annotationCount > 0) {
            symbolAnnotationKnownEmptyPageKeys.delete(pageKey);
        } else {
            symbolAnnotationKnownEmptyPageKeys.add(pageKey);
        }
    }
}

function attachSymbolVectorPatternToLabel(labelId, pattern) {
    const normalizedPattern = normalizeSymbolVectorPattern(pattern);
    if (!labelId || !normalizedPattern) {
        return false;
    }

    const updateLabels = labels => labels.map(label => (
        label.id === labelId
            ? { ...label, vectorPattern: normalizedPattern }
            : label
    ));
    symbolLabelDefinitions = updateLabels(symbolLabelDefinitions);
    symbolAnnotationDocumentLabels = mergeSymbolLabelDefinitionLists(
        updateLabels(symbolAnnotationDocumentLabels),
        symbolLabelDefinitions
    );
    symbolLabelDefinitions = mergeSymbolLabelDefinitionLists(symbolAnnotationDocumentLabels, symbolLabelDefinitions);
    return true;
}

function getNextSymbolClassId() {
    if (!symbolLabelDefinitions.length) return 0;
    return Math.max(...symbolLabelDefinitions.map(label => Number(label.classId) || 0)) + 1;
}

function normalizeSymbolColorToken(color) {
    return String(color || '').trim().toLowerCase();
}

function isSupportedSymbolColor(color) {
    const token = String(color || '').trim();
    if (!token) return false;
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
        return CSS.supports('color', token);
    }
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(token)
        || /^rgba?\(/i.test(token)
        || /^hsla?\(/i.test(token);
}

function hashSymbolColorSeed(seedValue) {
    const text = String(seedValue ?? 'symbol');
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash * 33) + text.charCodeAt(index)) >>> 0;
    }
    return hash;
}

function hslToHex(hue, saturation, lightness) {
    const normalizedHue = ((Number(hue) % 360) + 360) % 360;
    const normalizedSaturation = Math.max(0, Math.min(100, Number(saturation))) / 100;
    const normalizedLightness = Math.max(0, Math.min(100, Number(lightness))) / 100;

    const chroma = (1 - Math.abs((2 * normalizedLightness) - 1)) * normalizedSaturation;
    const huePrime = normalizedHue / 60;
    const secondComponent = chroma * (1 - Math.abs((huePrime % 2) - 1));

    let red = 0;
    let green = 0;
    let blue = 0;

    if (huePrime >= 0 && huePrime < 1) {
        red = chroma;
        green = secondComponent;
    } else if (huePrime < 2) {
        red = secondComponent;
        green = chroma;
    } else if (huePrime < 3) {
        green = chroma;
        blue = secondComponent;
    } else if (huePrime < 4) {
        green = secondComponent;
        blue = chroma;
    } else if (huePrime < 5) {
        red = secondComponent;
        blue = chroma;
    } else {
        red = chroma;
        blue = secondComponent;
    }

    const matchLightness = normalizedLightness - (chroma / 2);
    const toHex = value => Math.round((value + matchLightness) * 255).toString(16).padStart(2, '0');
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function buildSeededSymbolLabelColor(seedValue = 0, usedColors = new Set()) {
    const hash = hashSymbolColorSeed(seedValue);
    const normalizedUsedColors = new Set(
        Array.from(usedColors || []).map(color => normalizeSymbolColorToken(color))
    );

    for (let attempt = 0; attempt < SYMBOL_LABEL_COLOR_PALETTE.length; attempt += 1) {
        const candidate = SYMBOL_LABEL_COLOR_PALETTE[(hash + attempt) % SYMBOL_LABEL_COLOR_PALETTE.length];
        if (!normalizedUsedColors.has(normalizeSymbolColorToken(candidate))) {
            return candidate;
        }
    }

    const saturation = 68 + (hash % 8);
    const lightness = 44 + ((hash >>> 3) % 8);

    for (let attempt = 0; attempt < 24; attempt += 1) {
        const hue = (hash + (attempt * 29)) % 360;
        const candidate = hslToHex(hue, saturation, lightness);
        if (!normalizedUsedColors.has(normalizeSymbolColorToken(candidate))) {
            return candidate;
        }
    }

    return hslToHex(hash % 360, saturation, lightness);
}

function getUsedSymbolLabelColors(labels = []) {
    return new Set(
        labels
            .map(label => normalizeSymbolColorToken(label?.color))
            .filter(Boolean)
    );
}

function ensureDistinctSymbolLabelColors(labels = []) {
    const usedColors = new Set();
    return labels.map((label, index) => {
        const rawColor = isSupportedSymbolColor(label?.color)
            ? normalizeSymbolColorToken(label.color)
            : '';
        const hasUniqueColor = rawColor && !usedColors.has(rawColor);
        const color = hasUniqueColor
            ? label.color
            : buildSeededSymbolLabelColor(label?.slug || label?.name || label?.id || index, usedColors);
        usedColors.add(normalizeSymbolColorToken(color));
        return {
            ...label,
            color,
        };
    });
}

function getSymbolLabelColor(seedValue = 0, usedColors = new Set()) {
    return buildSeededSymbolLabelColor(seedValue, usedColors);
}

function getRandomSymbolLabelColor(existingLabels = symbolLabelDefinitions) {
    const usedColors = getUsedSymbolLabelColors(existingLabels);
    return buildSeededSymbolLabelColor(`${Date.now()}_${Math.random()}`, usedColors);
}

function getSelectedSymbolLabel() {
    return symbolLabelDefinitions.find(label => label.id === selectedSymbolLabelId) || null;
}

function findSymbolLabelDefinitionForAnnotation(annotation) {
    if (!annotation) return null;
    return symbolLabelDefinitions.find(label => label.id === annotation.labelId)
        || symbolLabelDefinitions.find(label => label.slug === annotation.labelSlug)
        || symbolLabelDefinitions.find(label => label.name === annotation.labelName)
        || null;
}

function resolveSymbolAnnotationColor(annotation) {
    const matchingLabel = findSymbolLabelDefinitionForAnnotation(annotation);
    if (isSupportedSymbolColor(matchingLabel?.color)) {
        return matchingLabel.color;
    }
    if (isSupportedSymbolColor(annotation?.color)) {
        return annotation.color;
    }
    return getSymbolLabelColor(annotation?.labelSlug || annotation?.labelName || annotation?.labelId || annotation?.classId || 'symbol');
}

function isSymbolAnnotationInteractionLocked() {
    return symbolAnnotationIsLoading;
}

function setSymbolAnnotationLoading(isLoading, message = 'Đang tải annotation...') {
    symbolAnnotationIsLoading = Boolean(isLoading);
    symbolAnnotationLoadingMessage = message || 'Đang tải annotation...';

    if (symbolAnnotationPanel) {
        symbolAnnotationPanel.classList.toggle('is-loading', symbolAnnotationIsLoading);
    }
    if (symbolAnnotationLoadingMask) {
        symbolAnnotationLoadingMask.hidden = !symbolAnnotationIsLoading;
    }
    if (symbolAnnotationLoadingText) {
        symbolAnnotationLoadingText.textContent = symbolAnnotationLoadingMessage;
    }

    if (symbolAnnotationIsLoading && (isSymbolFindArmed || isSymbolDeleteArmed)) {
        if (isDrawingBbox && btnDrawBbox) {
            btnDrawBbox.click();
        }
        clearSymbolAnnotationToolModes();
    }

    updateSymbolAnnotationUI();
}

function cancelSymbolAnnotationPageLoad() {
    symbolAnnotationLoadRequestId += 1;
    if (symbolAnnotationLoadAbortController) {
        try {
            symbolAnnotationLoadAbortController.abort();
        } catch (error) {
            console.warn('Failed to abort symbol annotation load:', error);
        }
        symbolAnnotationLoadAbortController = null;
    }
    if (symbolAnnotationIsLoading) {
        setSymbolAnnotationLoading(false);
    }
}

function suspendVisibleSymbolAnnotations(options = {}) {
    const pageKey = options.pageKey ?? getSymbolPageKey() ?? symbolAnnotationActivePageKey;
    const shouldClearLabels = options.clearLabels !== false;

    if (isDrawingBbox && (isSymbolFindArmed || isSymbolDeleteArmed) && btnDrawBbox) {
        btnDrawBbox.click();
    }
    clearSymbolAnnotationToolModes();
    symbolAnnotations = [];
    symbolAnnotationId = 0;
    if (pageKey) {
        symbolAnnotationActivePageKey = pageKey;
    }
    if (shouldClearLabels) {
        symbolLabelDefinitions = [];
        selectedSymbolLabelId = null;
    }
    updateSymbolAnnotationUI();
    if (typeof scheduleDraw === 'function') {
        scheduleDraw();
    }
}

function sortSymbolLabelDefinitions(labels) {
    return [...labels].sort((left, right) => (left.classId - right.classId) || left.name.localeCompare(right.name));
}

function getSymbolLabelCounts() {
    const counts = new Map();
    symbolAnnotations.forEach(annotation => {
        counts.set(annotation.labelId, (counts.get(annotation.labelId) || 0) + 1);
    });
    return counts;
}

function setSymbolAnnotationFeedback(message = '', tone = 'info') {
    symbolAnnotationFeedbackMessage = message;
    symbolAnnotationFeedbackTone = tone;
    updateSymbolAnnotationUI();
}

function syncSymbolSimilarityThresholdControl() {
    if (symbolSimilarityThresholdInput) {
        symbolSimilarityThresholdInput.value = String(symbolAnnotationSimilarityThreshold);
    }
    if (symbolSimilarityThresholdValue) {
        symbolSimilarityThresholdValue.textContent = `${symbolAnnotationSimilarityThreshold}%`;
    }
}

function setSymbolSimilarityThreshold(value, options = {}) {
    symbolAnnotationSimilarityThreshold = clampSymbolSimilarityThreshold(value);
    syncSymbolSimilarityThresholdControl();
    if (options.persist !== false) {
        try {
            localStorage.setItem(SYMBOL_SIMILARITY_THRESHOLD_STORAGE_KEY, String(symbolAnnotationSimilarityThreshold));
        } catch (error) {
            console.warn('Failed to persist symbol similarity threshold:', error);
        }
    }
    if (!options.silent) {
        setSymbolAnnotationFeedback(`Ngưỡng tìm object tương tự: ${symbolAnnotationSimilarityThreshold}%.`, 'info');
    }
}

function getSymbolSimilarityThresholdRatio() {
    return symbolAnnotationSimilarityThreshold / 100;
}

function clearSymbolAnnotationToolModes() {
    isSymbolFindArmed = false;
    isSymbolDeleteArmed = false;
}

function normalizeWorldRect(rect) {
    if (!rect) return null;
    const x = Number(rect.x);
    const y = Number(rect.y);
    const width = Number(rect.width);
    const height = Number(rect.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        return null;
    }
    return { x, y, width, height };
}

function roundRectKey(rect) {
    return [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 100) / 100).join('|');
}

function getRectArea(rect) {
    return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function getRectIntersectionArea(rectA, rectB) {
    const minX = Math.max(rectA.x, rectB.x);
    const minY = Math.max(rectA.y, rectB.y);
    const maxX = Math.min(rectA.x + rectA.width, rectB.x + rectB.width);
    const maxY = Math.min(rectA.y + rectA.height, rectB.y + rectB.height);
    const width = Math.max(0, maxX - minX);
    const height = Math.max(0, maxY - minY);
    return width * height;
}

function getRectIoU(rectA, rectB) {
    const intersection = getRectIntersectionArea(rectA, rectB);
    if (intersection <= 0) return 0;
    const union = getRectArea(rectA) + getRectArea(rectB) - intersection;
    return union > 0 ? (intersection / union) : 0;
}

function cloneSymbolAnnotation(annotation) {
    return {
        ...annotation,
        rect: { ...annotation.rect }
    };
}

function createSymbolAnnotation(label, rect, options = {}) {
    symbolAnnotationId += 1;
    return {
        id: options.id || `symbol_annotation_${symbolAnnotationId}`,
        labelId: label.id,
        labelName: label.name,
        labelSlug: label.slug,
        classId: label.classId,
        color: label.color,
        source: options.source || 'manual',
        matchScore: Number.isFinite(options.matchScore) ? Number(options.matchScore) : null,
        rect: { ...rect }
    };
}

function getMaxSymbolAnnotationSerial(annotations) {
    return annotations.reduce((maxSerial, annotation) => {
        const match = /^symbol_annotation_(\d+)$/.exec(String(annotation.id || ''));
        if (!match) return maxSerial;
        return Math.max(maxSerial, Number(match[1]) || 0);
    }, 0);
}