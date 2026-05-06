const symbolAnnotationPanel = document.getElementById('symbol-annotation-panel');
const symbolAnnotationPanelBody = document.getElementById('symbol-annotation-panel-body');
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
let symbolAnnotationIsLoading = false;
let symbolAnnotationLoadingMessage = 'Đang tải annotation...';
let symbolAnnotationLoadAbortController = null;
let symbolAnnotationExportInProgress = false;
let symbolAnnotationAutoFindInProgress = false;

const SYMBOL_ANNOTATION_PAGE_CACHE_LIMIT = 80;
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

    return {
        id: String(labelId),
        name: labelName,
        slug,
        classId,
        color: isSupportedSymbolColor(rawLabel.color) ? rawLabel.color : null,
        vectorPattern
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
            vectorPattern: existingLabel.vectorPattern || normalizedLabel.vectorPattern
        });
    });

    return ensureDistinctSymbolLabelColors(sortSymbolLabelDefinitions(Array.from(mergedBySlug.values())));
}

function setSymbolAnnotationDocumentLabels(labels = []) {
    symbolAnnotationDocumentLabels = mergeSymbolLabelDefinitionLists(symbolAnnotationDocumentLabels, labels);
    symbolLabelDefinitions = mergeSymbolLabelDefinitionLists(symbolAnnotationDocumentLabels, symbolLabelDefinitions);
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

function renderSymbolLabelList() {
    if (!symbolLabelList) return;

    if (!symbolLabelDefinitions.length) {
        symbolLabelList.innerHTML = '<div class="symbol-label-empty">Chưa có nhãn bbox.</div>';
        return;
    }

    const counts = getSymbolLabelCounts();
    const isLocked = isSymbolAnnotationInteractionLocked();
    symbolLabelList.innerHTML = symbolLabelDefinitions.map(label => {
        const isSelected = label.id === selectedSymbolLabelId;
        const isArmed = isSelected && isSymbolFindArmed;
        const labelCount = counts.get(label.id) || 0;
        const deleteTitle = labelCount > 0
            ? `Xóa nhãn ${label.name} và ${labelCount} bbox của nhãn này`
            : `Xóa nhãn ${label.name}`;
        return `
            <div class="symbol-label-chip${isSelected ? ' is-selected' : ''}${isArmed ? ' is-armed' : ''}">
                <button
                    type="button"
                    class="symbol-label-item"
                    data-symbol-label-id="${escapeHtml(label.id)}"
                    title="Chọn nhãn ${escapeHtml(label.name)}"
                    aria-pressed="${isSelected ? 'true' : 'false'}"
                    ${isLocked ? 'disabled' : ''}
                >
                    <span class="symbol-label-swatch" style="background:${escapeHtml(label.color)}"></span>
                    <span>${escapeHtml(label.name)}</span>
                    <span class="symbol-label-count">${labelCount}</span>
                </button>
                <button
                    type="button"
                    class="symbol-label-delete"
                    data-symbol-label-delete-id="${escapeHtml(label.id)}"
                    title="${escapeHtml(deleteTitle)}"
                    aria-label="${escapeHtml(deleteTitle)}"
                    ${isLocked ? 'disabled' : ''}
                >&times;</button>
            </div>
        `;
    }).join('');

    symbolLabelList.querySelectorAll('[data-symbol-label-id]').forEach(button => {
        button.addEventListener('click', () => {
            selectSymbolLabel(button.dataset.symbolLabelId);
        });
    });
    symbolLabelList.querySelectorAll('[data-symbol-label-delete-id]').forEach(button => {
        button.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            await removeSymbolLabel(button.dataset.symbolLabelDeleteId);
        });
    });
}

function selectSymbolLabel(labelId) {
    if (isSymbolAnnotationInteractionLocked()) return;
    if (!symbolLabelDefinitions.some(label => label.id === labelId)) return;

    if (selectedSymbolLabelId === labelId) {
        selectedSymbolLabelId = null;
        if (isSymbolFindArmed) {
            if (isDrawingBbox && btnDrawBbox) {
                btnDrawBbox.click();
            }
            isSymbolFindArmed = false;
        }
        symbolAnnotationFeedbackMessage = '';
        symbolAnnotationFeedbackTone = 'info';
        updateSymbolAnnotationUI();
        return;
    }

    selectedSymbolLabelId = labelId;
    updateSymbolAnnotationUI();
    activateSymbolFindArming();
}

function addSymbolLabel(name, options = {}) {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
        setSymbolAnnotationFeedback('Tên nhãn không được để trống.', 'error');
        return null;
    }

    const slug = slugifySymbolLabelName(trimmedName);
    const existing = symbolLabelDefinitions.find(label => label.slug === slug);
    if (existing) {
        selectedSymbolLabelId = existing.id;
        updateSymbolAnnotationUI();
        if (!options.silent) {
            setSymbolAnnotationFeedback(`Nhãn ${existing.name} đã tồn tại, đã chuyển sang nhãn này.`, 'info');
        }
        return existing;
    }

    const resolvedClassId = Number.isFinite(options.classId) ? Number(options.classId) : getNextSymbolClassId();

    const label = {
        id: options.id || `symbol_label_${slug}_${resolvedClassId}`,
        name: trimmedName,
        slug,
        classId: resolvedClassId,
        color: null
    };
    label.color = isSupportedSymbolColor(options.color)
        ? options.color
        : getRandomSymbolLabelColor(symbolLabelDefinitions);
    symbolAnnotationDocumentLabels = mergeSymbolLabelDefinitionLists(symbolAnnotationDocumentLabels, [label]);
    symbolLabelDefinitions = mergeSymbolLabelDefinitionLists(symbolAnnotationDocumentLabels, symbolLabelDefinitions, [label]);
    selectedSymbolLabelId = label.id;
    persistCurrentSymbolAnnotationState();
    updateSymbolAnnotationUI();
    if (!options.silent) {
        setSymbolAnnotationFeedback(`Đã tạo nhãn ${label.name}.`, 'success');
    }
    return label;
}

async function removeSymbolLabel(labelId, options = {}) {
    if (isSymbolAnnotationInteractionLocked()) return false;

    const label = symbolLabelDefinitions.find(candidate => candidate.id === labelId);
    if (!label) {
        return false;
    }

    const removedCount = symbolAnnotations.filter(annotation => annotation.labelId === label.id).length;
    if (!options.skipConfirm) {
        const confirmMessage = removedCount > 0
            ? `Xóa nhãn ${label.name} sẽ xóa ${removedCount} bbox của nhãn này trên page hiện tại. Bạn có muốn tiếp tục không?`
            : `Xóa nhãn ${label.name} khỏi page hiện tại?`;
        if (!window.confirm(confirmMessage)) {
            return false;
        }
    }

    symbolLabelDefinitions = symbolLabelDefinitions.filter(candidate => candidate.id !== label.id);
    symbolAnnotationDocumentLabels = symbolAnnotationDocumentLabels.filter(candidate => candidate.id !== label.id && candidate.slug !== label.slug);
    symbolAnnotations = symbolAnnotations.filter(annotation => annotation.labelId !== label.id);

    if (selectedSymbolLabelId === label.id) {
        selectedSymbolLabelId = null;
        if (isSymbolFindArmed) {
            if (isDrawingBbox && btnDrawBbox) {
                btnDrawBbox.click();
            }
            isSymbolFindArmed = false;
        }
    }

    persistCurrentSymbolAnnotationState();
    updateSymbolAnnotationUI();
    if (typeof scheduleDraw === 'function') {
        scheduleDraw();
    }

    const removedSummary = removedCount > 0
        ? `Đã xóa nhãn ${label.name} cùng ${removedCount} bbox của nhãn này.`
        : `Đã xóa nhãn ${label.name}.`;
    if (!getSymbolPageKey()) {
        setSymbolAnnotationFeedback(removedSummary, 'success');
        return true;
    }

    setSymbolAnnotationFeedback(`${removedSummary} Đang tự động lưu DB...`, 'info');
    try {
        const saveResult = await saveSymbolAnnotationsForCurrentPage({ silent: true });
        setSymbolAnnotationFeedback(`${removedSummary} Save DB thành công (${saveResult?.storage_backend || 'db'}).`, 'success');
        return true;
    } catch (error) {
        console.error('Failed to auto-save removed symbol label:', error);
        setSymbolAnnotationFeedback(`${removedSummary} Nhưng tự động lưu DB thất bại: ${error.message}`, 'error');
        return false;
    }
}

function getPendingSymbolLabelName() {
    return String(symbolLabelNameInput?.value || '').trim();
}

function ensureSymbolLabelReadyForDraw() {
    const selectedLabel = getSelectedSymbolLabel();
    if (selectedLabel) {
        return selectedLabel;
    }

    const pendingLabelName = getPendingSymbolLabelName();
    if (!pendingLabelName) {
        return null;
    }

    const createdLabel = addSymbolLabel(pendingLabelName, { silent: true });
    if (createdLabel && symbolLabelNameInput) {
        symbolLabelNameInput.value = '';
    }
    return createdLabel;
}

function removeOverlappingSymbolAnnotations(incomingAnnotations) {
    if (!incomingAnnotations.length) return;
    symbolAnnotations = symbolAnnotations.filter(existing =>
        !incomingAnnotations.some(incoming => getRectIoU(existing.rect, incoming.rect) >= 0.92)
    );
}

function mergeSymbolAnnotations(incomingAnnotations) {
    if (!incomingAnnotations.length) return 0;
    removeOverlappingSymbolAnnotations(incomingAnnotations);
    symbolAnnotations = [...symbolAnnotations, ...incomingAnnotations.map(cloneSymbolAnnotation)];
    persistCurrentSymbolAnnotationState();
    updateSymbolAnnotationUI();
    if (typeof scheduleDraw === 'function') scheduleDraw();
    return incomingAnnotations.length;
}

function isSymbolAnnotationSelectedByRect(annotationRect, selectionRect) {
    if (!annotationRect || !selectionRect) return false;
    const centerX = annotationRect.x + (annotationRect.width / 2);
    const centerY = annotationRect.y + (annotationRect.height / 2);
    const centerInside = centerX >= selectionRect.x
        && centerX <= selectionRect.x + selectionRect.width
        && centerY >= selectionRect.y
        && centerY <= selectionRect.y + selectionRect.height;
    if (centerInside) return true;

    const intersectionArea = getRectIntersectionArea(annotationRect, selectionRect);
    if (intersectionArea <= 0) return false;
    const annotationArea = getRectArea(annotationRect);
    return annotationArea > 0 && (intersectionArea / annotationArea) >= 0.1;
}

async function deleteSymbolAnnotationsBySelectionRect(selectionRect) {
    const normalizedSelectionRect = normalizeWorldRect(selectionRect);
    if (!normalizedSelectionRect) {
        setSymbolAnnotationFeedback('BBox xóa annotation không hợp lệ.', 'error');
        return 0;
    }

    const beforeCount = symbolAnnotations.length;
    const remainingAnnotations = symbolAnnotations.filter(annotation => !isSymbolAnnotationSelectedByRect(annotation.rect, normalizedSelectionRect));
    const deletedCount = beforeCount - remainingAnnotations.length;
    if (deletedCount <= 0) {
        setSymbolAnnotationFeedback('Không có annotation nào nằm trong bbox vừa vẽ.', 'info');
        return 0;
    }

    if (!window.confirm(`Xóa ${deletedCount} bbox nằm trong vùng chọn?`)) {
        setSymbolAnnotationFeedback('Đã hủy xóa bbox annotation.', 'info');
        return 0;
    }

    symbolAnnotations = remainingAnnotations;

    persistCurrentSymbolAnnotationState();
    updateSymbolAnnotationUI();
    if (typeof scheduleDraw === 'function') {
        scheduleDraw();
    }

    setSymbolAnnotationFeedback(`Đã xóa ${deletedCount} bbox trên FE. Đang ghi DB...`, 'info');
    try {
        const saveResult = await saveSymbolAnnotationsForCurrentPage({ silent: true });
        setSymbolAnnotationFeedback(`Đã xóa ${deletedCount} bbox. Save DB thành công (${saveResult?.storage_backend || 'db'}).`, 'success');
    } catch (error) {
        console.error('Failed to auto-save deleted symbol annotations:', error);
        setSymbolAnnotationFeedback(`Đã xóa ${deletedCount} bbox trên FE nhưng ghi DB thất bại: ${error.message}`, 'error');
    }
    return deletedCount;
}

function syncSymbolFindButton() {
    if (btnSymbolDrawMatch) {
        btnSymbolDrawMatch.textContent = isSymbolFindArmed ? 'Hủy tìm' : 'Vẽ + tìm';
        btnSymbolDrawMatch.classList.toggle('is-active', isSymbolFindArmed);
    }
    if (btnSymbolDeleteByBbox) {
        btnSymbolDeleteByBbox.textContent = isSymbolDeleteArmed ? 'Hủy xóa' : 'Xóa bbox';
        btnSymbolDeleteByBbox.classList.toggle('is-active', isSymbolDeleteArmed);
    }
}

function applySymbolAnnotationPanelState(collapsed) {
    isSymbolAnnotationPanelCollapsed = Boolean(collapsed);
    if (symbolAnnotationPanel) {
        symbolAnnotationPanel.classList.toggle('is-collapsed', isSymbolAnnotationPanelCollapsed);
    }
    if (btnToggleSymbolAnnotationPanel) {
        btnToggleSymbolAnnotationPanel.setAttribute('aria-expanded', String(!isSymbolAnnotationPanelCollapsed));
        btnToggleSymbolAnnotationPanel.title = isSymbolAnnotationPanelCollapsed ? 'Mở rộng' : 'Thu gọn';
    }
    try {
        localStorage.setItem('visual_pdf_object.symbol_annotation_collapsed', isSymbolAnnotationPanelCollapsed ? '1' : '0');
    } catch (error) {
        console.warn('Failed to persist symbol annotation panel state:', error);
    }

    if (isSymbolAnnotationPanelCollapsed) {
        cancelSymbolAnnotationPageLoad();
        suspendVisibleSymbolAnnotations({ clearLabels: false });
    }
}

function getSymbolAnnotationPageBounds() {
    if (documentMetadata && Array.isArray(documentMetadata.bbox_all) && documentMetadata.bbox_all.length === 4) {
        const [minX, minY, maxX, maxY] = documentMetadata.bbox_all.map(Number);
        if ([minX, minY, maxX, maxY].every(Number.isFinite) && maxX > minX && maxY > minY) {
            return {
                minX,
                minY,
                maxX,
                maxY,
                width: maxX - minX,
                height: maxY - minY
            };
        }
    }

    if (typeof getRenderableLayerBounds === 'function') {
        const bounds = getRenderableLayerBounds();
        if (bounds) return bounds;
    }

    return null;
}

function rectToYoloBbox(rect, bounds) {
    const centerX = ((rect.x - bounds.minX) + (rect.width / 2)) / bounds.width;
    const centerY = ((rect.y - bounds.minY) + (rect.height / 2)) / bounds.height;
    return {
        x_center: Number(centerX.toFixed(6)),
        y_center: Number(centerY.toFixed(6)),
        width: Number((rect.width / bounds.width).toFixed(6)),
        height: Number((rect.height / bounds.height).toFixed(6))
    };
}

function buildSymbolAnnotationPagePayload() {
    const pdfName = getCurrentSymbolDocumentName();
    const pageNum = Number(currentPageNum);
    const bounds = getSymbolAnnotationPageBounds();
    if (!pdfName || !Number.isFinite(pageNum) || pageNum < 1 || !bounds) {
        return null;
    }

    return {
        pdf_name: pdfName,
        page_num: pageNum,
        page_bounds: {
            min_x: bounds.minX,
            min_y: bounds.minY,
            max_x: bounds.maxX,
            max_y: bounds.maxY,
            width: bounds.width,
            height: bounds.height
        },
        labels: getSymbolAnnotationPayloadLabels().map(serializeSymbolLabelDefinition),
        annotations: symbolAnnotations.map(annotation => ({
            annotation_id: annotation.id,
            label_id: annotation.labelId,
            label_name: annotation.labelName,
            label_slug: annotation.labelSlug,
            class_id: annotation.classId,
            color: resolveSymbolAnnotationColor(annotation),
            source: annotation.source,
            match_score: annotation.matchScore,
            world_bbox: {
                x: Number(annotation.rect.x.toFixed(4)),
                y: Number(annotation.rect.y.toFixed(4)),
                width: Number(annotation.rect.width.toFixed(4)),
                height: Number(annotation.rect.height.toFixed(4))
            },
            yolo_bbox: rectToYoloBbox(annotation.rect, bounds)
        }))
    };
}

function cloneSymbolAnnotationPayload(payload) {
    if (!payload) return null;
    try {
        return JSON.parse(JSON.stringify(payload));
    } catch (error) {
        console.warn('Failed to clone symbol annotation payload:', error);
        return null;
    }
}

function cacheSymbolAnnotationPagePayload(pageKey, payload) {
    const clonedPayload = cloneSymbolAnnotationPayload(payload);
    if (!pageKey || !clonedPayload) {
        return null;
    }

    if (Array.isArray(clonedPayload.labels) && clonedPayload.labels.length) {
        setSymbolAnnotationDocumentLabels(clonedPayload.labels);
    }

    const annotationCount = Array.isArray(clonedPayload.annotations) ? clonedPayload.annotations.length : 0;
    if (annotationCount > 0) {
        symbolAnnotationKnownEmptyPageKeys.delete(pageKey);
    } else {
        symbolAnnotationKnownEmptyPageKeys.add(pageKey);
    }

    if (symbolAnnotationPageCache.has(pageKey)) {
        symbolAnnotationPageCache.delete(pageKey);
    }
    symbolAnnotationPageCache.set(pageKey, clonedPayload);

    while (symbolAnnotationPageCache.size > SYMBOL_ANNOTATION_PAGE_CACHE_LIMIT) {
        const oldestEntry = symbolAnnotationPageCache.keys().next();
        if (oldestEntry.done) break;
        symbolAnnotationPageCache.delete(oldestEntry.value);
    }
    return cloneSymbolAnnotationPayload(clonedPayload);
}

function getCachedSymbolAnnotationPagePayload(pageKey) {
    if (!pageKey || !symbolAnnotationPageCache.has(pageKey)) {
        if (pageKey && symbolAnnotationKnownEmptyPageKeys.has(pageKey)) {
            const parsedKey = parseSymbolPageKey(pageKey);
            if (parsedKey) {
                return buildEmptySymbolAnnotationClientPayload(parsedKey.pdfName, parsedKey.pageNum);
            }
        }
        return null;
    }

    const cachedPayload = symbolAnnotationPageCache.get(pageKey);
    symbolAnnotationPageCache.delete(pageKey);
    symbolAnnotationPageCache.set(pageKey, cachedPayload);
    return cloneSymbolAnnotationPayload(cachedPayload);
}

function isSymbolPageDirty(pageKey) {
    return Boolean(pageKey && symbolAnnotationDirtyPageKeys.has(pageKey));
}

function getSymbolPageRevision(pageKey = getSymbolPageKey()) {
    return symbolAnnotationPageRevisions.get(pageKey) || 0;
}

function bumpSymbolPageRevision(pageKey = getSymbolPageKey()) {
    if (!pageKey) return 0;
    const nextRevision = getSymbolPageRevision(pageKey) + 1;
    symbolAnnotationPageRevisions.set(pageKey, nextRevision);
    return nextRevision;
}

function setSymbolPageRevision(pageKey = getSymbolPageKey(), revision = 0) {
    if (!pageKey) return;
    symbolAnnotationPageRevisions.set(pageKey, Math.max(0, Number(revision) || 0));
}

function markSymbolPageDirty(pageKey = getSymbolPageKey()) {
    if (!pageKey) return;
    symbolAnnotationDirtyPageKeys.add(pageKey);
}

function markSymbolPageClean(pageKey = getSymbolPageKey()) {
    if (!pageKey) return;
    symbolAnnotationDirtyPageKeys.delete(pageKey);
}

function persistCurrentSymbolAnnotationState(options = {}) {
    const payload = buildSymbolAnnotationPagePayload();
    if (!payload) {
        return null;
    }

    const pageKey = getSymbolPageKey(payload.pdf_name, payload.page_num);
    if (!pageKey) {
        return null;
    }

    symbolAnnotationActivePageKey = pageKey;
    cacheSymbolAnnotationPagePayload(pageKey, payload);
    if (options.dirty === false) {
        setSymbolPageRevision(pageKey, options.revision ?? getSymbolPageRevision(pageKey));
        markSymbolPageClean(pageKey);
    } else {
        bumpSymbolPageRevision(pageKey);
        markSymbolPageDirty(pageKey);
    }
    return payload;
}

async function parseSymbolAnnotationErrorResponse(response) {
    let detail = `HTTP error! status: ${response.status}`;
    try {
        const errorPayload = await response.json();
        if (errorPayload?.detail) {
            detail = String(errorPayload.detail);
        }
    } catch (error) {
        try {
            const errorText = await response.text();
            if (errorText.trim()) {
                detail = `${detail} - ${errorText.trim()}`;
            }
        } catch (nestedError) {}
    }
    return detail;
}

async function fetchSymbolAnnotationJson(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(await parseSymbolAnnotationErrorResponse(response));
    }
    return response.json();
}

async function loadSymbolAnnotationDocumentSummary(options = {}) {
    syncSymbolAnnotationCacheDocument();
    const pdfName = getCurrentSymbolDocumentName();
    const documentKey = getCurrentSymbolDocumentCacheKey();
    if (!pdfName || !documentKey) {
        return null;
    }

    if (!options.forceRefresh && symbolAnnotationDocumentSummary && symbolAnnotationDocumentSummaryKey === documentKey) {
        return cloneSymbolAnnotationPayload(symbolAnnotationDocumentSummary);
    }

    if (!options.forceRefresh && symbolAnnotationDocumentSummaryPromise) {
        return symbolAnnotationDocumentSummaryPromise;
    }

    const url = new URL(`${ENV.API_BASE_URL}/annotations/symbols/document`);
    url.searchParams.set('pdf_name', pdfName);

    symbolAnnotationDocumentSummaryPromise = fetchSymbolAnnotationJson(url.toString())
        .then(data => {
            symbolAnnotationDocumentSummary = cloneSymbolAnnotationPayload(data);
            symbolAnnotationDocumentSummaryKey = documentKey;
            setSymbolAnnotationDocumentLabels(data?.labels || []);
            return cloneSymbolAnnotationPayload(symbolAnnotationDocumentSummary);
        })
        .finally(() => {
            symbolAnnotationDocumentSummaryPromise = null;
        });

    return symbolAnnotationDocumentSummaryPromise;
}

async function fetchSymbolAnnotationPagePayload(pdfName, pageNum, options = {}) {
    syncSymbolAnnotationCacheDocument();
    const pageKey = getSymbolPageKey(pdfName, pageNum);
    if (!pageKey) {
        return null;
    }

    const cachedPayload = !options.forceRefresh
        ? getCachedSymbolAnnotationPagePayload(pageKey)
        : null;
    if (cachedPayload) {
        return cachedPayload;
    }

    const sharedLoad = !options.forceRefresh
        ? symbolAnnotationPendingPageLoads.get(pageKey)
        : null;
    if (sharedLoad) {
        return sharedLoad;
    }

    const url = new URL(`${ENV.API_BASE_URL}/annotations/symbols/page`);
    url.searchParams.set('pdf_name', pdfName);
    url.searchParams.set('page_num', String(pageNum));

    const fetchPromise = fetchSymbolAnnotationJson(url.toString())
        .then(data => {
            const payload = cacheSymbolAnnotationPagePayload(pageKey, data) || data;
            markSymbolPageClean(pageKey);
            return cloneSymbolAnnotationPayload(payload);
        })
        .finally(() => {
            if (symbolAnnotationPendingPageLoads.get(pageKey) === fetchPromise) {
                symbolAnnotationPendingPageLoads.delete(pageKey);
            }
        });
    symbolAnnotationPendingPageLoads.set(pageKey, fetchPromise);
    return fetchPromise;
}

async function saveSymbolAnnotationPayload(payload, options = {}) {
    const pageKey = options.pageKey || getSymbolPageKey(payload?.pdf_name, payload?.page_num);
    if (!payload || !pageKey) {
        if (!options.silent) {
            setSymbolAnnotationFeedback('Chưa đủ ngữ cảnh PDF/page để lưu symbol annotation.', 'error');
        }
        return null;
    }

    if (symbolAnnotationPendingSaveKeys.has(pageKey)) {
        symbolAnnotationQueuedSaveKeys.add(pageKey);
        return null;
    }

    const isCurrentPage = pageKey === getSymbolPageKey();
    const saveRevision = getSymbolPageRevision(pageKey);
    symbolAnnotationPendingSaveKeys.add(pageKey);
    if (isCurrentPage) {
        updateSymbolAnnotationUI();
    }

    try {
        const response = await fetch(`${ENV.API_BASE_URL}/annotations/symbols/page`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw new Error(await parseSymbolAnnotationErrorResponse(response));
        }

        const data = await response.json();
        cacheSymbolAnnotationPagePayload(pageKey, {
            pdf_name: payload.pdf_name,
            page_num: payload.page_num,
            page_bounds: payload.page_bounds,
            labels: payload.labels || [],
            annotations: payload.annotations || [],
            annotation_count: Array.isArray(payload.annotations) ? payload.annotations.length : 0,
            storage_backend: data.storage_backend || 'db'
        });
        if (getSymbolPageRevision(pageKey) === saveRevision) {
            markSymbolPageClean(pageKey);
        }

        if (!options.silent && isCurrentPage && getSymbolPageRevision(pageKey) === saveRevision) {
            setSymbolAnnotationFeedback(
                `Save DB thành công: ${data.annotation_count || symbolAnnotations.length} bbox cho page ${payload.page_num} (${data.storage_backend || 'db'}).`,
                'success'
            );
        }
        return data;
    } finally {
        symbolAnnotationPendingSaveKeys.delete(pageKey);
        const needsFollowUpSave = symbolAnnotationQueuedSaveKeys.has(pageKey)
            || (isSymbolPageDirty(pageKey) && getSymbolPageRevision(pageKey) !== saveRevision);
        symbolAnnotationQueuedSaveKeys.delete(pageKey);
        if (isCurrentPage) {
            updateSymbolAnnotationUI();
        }
        if (needsFollowUpSave) {
            void saveDirtySymbolAnnotationPage(pageKey, { silent: true }).catch(error => {
                console.error('Failed to flush queued symbol annotation save:', error);
            });
        }
    }
}

async function saveDirtySymbolAnnotationPage(pageKey, options = {}) {
    if (!pageKey || !isSymbolPageDirty(pageKey)) {
        return null;
    }

    const payload = getCachedSymbolAnnotationPagePayload(pageKey);
    if (!payload) {
        markSymbolPageClean(pageKey);
        return null;
    }
    return saveSymbolAnnotationPayload(payload, { ...options, pageKey });
}

async function saveSymbolAnnotationsForCurrentPage(options = {}) {
    const payload = persistCurrentSymbolAnnotationState();
    if (!payload) {
        if (!options.silent) {
            setSymbolAnnotationFeedback('Chưa đủ ngữ cảnh PDF/page để lưu symbol annotation.', 'error');
        }
        return null;
    }
    return saveSymbolAnnotationPayload(payload, {
        ...options,
        pageKey: getSymbolPageKey(payload.pdf_name, payload.page_num)
    });
}

async function getSymbolAnnotationExportImageCanvas(pageNum = Number(currentPageNum)) {
    if (!currentPdfFile) {
        throw new Error('Cần mở file PDF gốc để export ảnh x3.');
    }

    const resolvedPageNum = Number(pageNum);
    if (!Number.isFinite(resolvedPageNum) || resolvedPageNum < 1) {
        throw new Error('Page export không hợp lệ.');
    }

    const pdf = await ensureCurrentPdfDocument();
    let page = null;
    try {
        page = await pdf.getPage(resolvedPageNum);
        const scale = CONFIG.PDF_PAGE_CACHE_SCALE || 3;
        const viewport = page.getViewport({ scale });
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = Math.max(1, Math.ceil(viewport.width));
        sourceCanvas.height = Math.max(1, Math.ceil(viewport.height));
        const sourceContext = sourceCanvas.getContext('2d', { alpha: false });
        if (!sourceContext) {
            throw new Error('Không tạo được canvas export PDF.');
        }
        await page.render({
            canvasContext: sourceContext,
            viewport
        }).promise;
        return sourceCanvas;
    } finally {
        if (page) {
            try { page.cleanup(); } catch (error) {}
        }
    }
}

function buildSymbolAnnotationDatasetSampleStem(payload) {
    const baseName = typeof getCurrentExportBaseName === 'function'
        ? getCurrentExportBaseName()
        : getCurrentSymbolDocumentName().replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_\-.]/g, '_');
    const pageNum = Number(payload?.page_num || currentPageNum || 0);
    return `${baseName || 'symbol_dataset'}_p${String(Math.max(1, pageNum)).padStart(4, '0')}`;
}

function collectSymbolAnnotationDatasetLabels(payloadOrPayloads) {
    const payloads = Array.isArray(payloadOrPayloads) ? payloadOrPayloads : [payloadOrPayloads];
    const labelsByKey = new Map();
    let nextClassId = 0;

    payloads.forEach(payload => {
        (payload?.labels || []).forEach(label => {
            const labelName = String(label?.name || '').trim();
            if (!labelName) return;
            const classId = Number.isFinite(Number(label?.class_id)) ? Number(label.class_id) : nextClassId;
            nextClassId = Math.max(nextClassId, classId + 1);
            const labelKey = label.label_id || label.slug || labelName;
            labelsByKey.set(labelKey, {
                key: labelKey,
                name: labelName,
                slug: label.slug || slugifySymbolLabelName(labelName),
                classId,
            });
        });

        (payload?.annotations || []).forEach(annotation => {
            const labelName = String(annotation?.label_name || '').trim();
            if (!labelName) return;
            const labelKey = annotation.label_id || annotation.label_slug || labelName;
            if (labelsByKey.has(labelKey)) {
                return;
            }
            const classId = Number.isFinite(Number(annotation?.class_id)) ? Number(annotation.class_id) : nextClassId;
            nextClassId = Math.max(nextClassId, classId + 1);
            labelsByKey.set(labelKey, {
                key: labelKey,
                name: labelName,
                slug: annotation.label_slug || slugifySymbolLabelName(labelName),
                classId,
            });
        });
    });

    return Array.from(labelsByKey.values())
        .sort((left, right) => (left.classId - right.classId) || left.name.localeCompare(right.name))
        .map((label, index) => ({
            ...label,
            exportClassId: index,
        }));
}

function buildSymbolAnnotationDatasetYaml(labels) {
    const inlineNames = labels
        .map(label => `'${String(label.name || '').replace(/'/g, "''")}'`)
        .join(', ');
    const lines = [
        'train: train/images',
        'val: valid/images',
        '',
        `nc: ${labels.length}`,
        `names: [${inlineNames}]`,
    ];

    return `${lines.join('\n')}\n`;
}

function clampSymbolAnnotationYoloValue(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function buildSymbolAnnotationDatasetLabelText(payload, labels) {
    const classIdLookup = new Map();
    labels.forEach(label => {
        classIdLookup.set(label.key, label.exportClassId);
        classIdLookup.set(label.slug, label.exportClassId);
        classIdLookup.set(label.name, label.exportClassId);
    });

    return (payload?.annotations || []).map(annotation => {
        const labelKey = annotation.label_id || annotation.label_slug || annotation.label_name;
        const classId = classIdLookup.get(labelKey);
        if (!Number.isFinite(Number(classId))) {
            return '';
        }
        const yoloBbox = annotation?.yolo_bbox;
        const width = clampSymbolAnnotationYoloValue(yoloBbox?.width);
        const height = clampSymbolAnnotationYoloValue(yoloBbox?.height);
        if (width <= 0 || height <= 0) {
            return '';
        }
        return [
            Number(classId),
            clampSymbolAnnotationYoloValue(yoloBbox?.x_center).toFixed(6),
            clampSymbolAnnotationYoloValue(yoloBbox?.y_center).toFixed(6),
            width.toFixed(6),
            height.toFixed(6)
        ].join(' ');
    }).filter(Boolean).join('\n');
}

async function downloadSymbolAnnotationDatasetZip(zip, fileName) {
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    if (typeof triggerBlobDownload === 'function') {
        triggerBlobDownload(zipBlob, fileName);
        return zipBlob;
    }

    const blobUrl = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    return zipBlob;
}

async function getSymbolAnnotationDocumentPageNumbers() {
    const pageNumbers = new Set();
    Object.keys(pageThumbnailRefs || {}).forEach(pageNum => pageNumbers.add(Number(pageNum)));
    Object.keys(cachedPages || {}).forEach(pageNum => pageNumbers.add(Number(pageNum)));
    Object.keys(stagedCachedPages || {}).forEach(pageNum => pageNumbers.add(Number(pageNum)));
    if (currentPageNum) {
        pageNumbers.add(Number(currentPageNum));
    }

    if (currentPdfFile) {
        try {
            const pdf = await ensureCurrentPdfDocument();
            if (pdf?.numPages) {
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
                    pageNumbers.add(pageNum);
                }
            }
        } catch (error) {
            console.warn('Could not read PDF page count for symbol annotation export:', error);
        }
    }

    return Array.from(pageNumbers)
        .filter(pageNum => Number.isFinite(pageNum) && pageNum > 0)
        .sort((left, right) => left - right);
}

async function collectSymbolAnnotationExportPayloadsForDocument() {
    const pdfName = getCurrentSymbolDocumentName();
    if (!pdfName) {
        throw new Error('Chưa có tên PDF để export annotation.');
    }

    try {
        await loadSymbolAnnotationDocumentSummary({ silent: true });
    } catch (error) {
        console.warn('Failed to load symbol annotation document summary for export:', error);
    }

    const pageNumbers = await getSymbolAnnotationDocumentPageNumbers();
    if (!pageNumbers.length) {
        throw new Error('Không xác định được danh sách page để export.');
    }

    const payloads = [];
    for (let index = 0; index < pageNumbers.length; index += 1) {
        const pageNum = pageNumbers[index];
        setSymbolAnnotationLoading(true, `Đang tải annotation page ${pageNum} (${index + 1}/${pageNumbers.length})...`);

        let payload = null;
        const pageKey = getSymbolPageKey(pdfName, pageNum);
        if (pageKey === getSymbolPageKey()) {
            payload = buildSymbolAnnotationPagePayload();
            if (payload) {
                cacheSymbolAnnotationPagePayload(pageKey, payload);
            }
        }

        if (!payload) {
            payload = await fetchSymbolAnnotationPagePayload(pdfName, pageNum);
        }

        if (payload && Array.isArray(payload.annotations) && payload.annotations.length) {
            payloads.push(payload);
        }

        if (typeof yieldToBrowser === 'function') {
            await yieldToBrowser();
        }
    }

    return payloads;
}

async function exportSymbolAnnotationsDatasetForCurrentPage() {
    if (!currentPdfFile) {
        throw new Error('Cần mở file PDF gốc để export ảnh x3.');
    }

    symbolAnnotationExportInProgress = true;
    setSymbolAnnotationLoading(true, 'Đang chuẩn bị export toàn bộ annotation PDF...');

    try {
        const payloads = await collectSymbolAnnotationExportPayloadsForDocument();
        if (!payloads.length) {
            throw new Error('PDF hiện chưa có bbox annotation nào để export.');
        }

        const labels = collectSymbolAnnotationDatasetLabels(payloads);
        const JSZipCtor = await ensureJsZip();
        const zip = new JSZipCtor();
        const datasetRoot = 'data';
        let exportedCount = 0;

        zip.folder(`${datasetRoot}/train/images`);
        zip.folder(`${datasetRoot}/train/labels`);
        zip.folder(`${datasetRoot}/valid/images`);
        zip.folder(`${datasetRoot}/valid/labels`);

        for (let index = 0; index < payloads.length; index += 1) {
            const payload = payloads[index];
            setSymbolAnnotationLoading(true, `Đang render ảnh page ${payload.page_num} (${index + 1}/${payloads.length})...`);
            const sourceCanvas = await getSymbolAnnotationExportImageCanvas(payload.page_num);
            const labelText = buildSymbolAnnotationDatasetLabelText(payload, labels);
            const sampleStem = buildSymbolAnnotationDatasetSampleStem(payload);

            if (typeof saveCanvasToZip === 'function') {
                saveCanvasToZip(zip, `${datasetRoot}/train/images/${sampleStem}.jpg`, sourceCanvas, 'image/jpeg', 0.95);
            } else {
                zip.file(`${datasetRoot}/train/images/${sampleStem}.jpg`, sourceCanvas.toDataURL('image/jpeg', 0.95).split(',')[1], { base64: true });
            }
            zip.file(`${datasetRoot}/train/labels/${sampleStem}.txt`, labelText);
            exportedCount += labelText ? labelText.split(/\n+/).filter(Boolean).length : 0;

            if (typeof yieldToBrowser === 'function') {
                await yieldToBrowser();
            }
        }

        zip.file(`${datasetRoot}/data.yaml`, buildSymbolAnnotationDatasetYaml(labels));

        const baseName = typeof getCurrentExportBaseName === 'function'
            ? getCurrentExportBaseName()
            : getCurrentSymbolDocumentName().replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_\-.]/g, '_');
        const zipFileName = `${baseName || 'symbol_dataset'}_all_pages_dataset.zip`;
        const zipBlob = await downloadSymbolAnnotationDatasetZip(zip, zipFileName);
        setSymbolAnnotationFeedback(
            `Export zip xong ${exportedCount} bbox trên ${payloads.length} page: ${zipFileName} (${formatBytes(zipBlob.size)}).`,
            'success'
        );
        return {
            ok: true,
            page_count: payloads.length,
            annotation_count: exportedCount,
            zip_file_name: zipFileName,
            zip_size: zipBlob.size,
        };
    } finally {
        symbolAnnotationExportInProgress = false;
        setSymbolAnnotationLoading(false);
        updateSymbolAnnotationUI();
    }
}

function applyLoadedSymbolAnnotationPayload(payload, options = {}) {
    const previousSelectedId = selectedSymbolLabelId;
    const pageKey = getSymbolPageKey(payload?.pdf_name, payload?.page_num);

    const loadedLabels = (payload.labels || [])
        .map((label, index) => normalizeSymbolLabelDefinition(label, index))
        .filter(Boolean);
    if (loadedLabels.length) {
        setSymbolAnnotationDocumentLabels(loadedLabels);
    } else {
        symbolLabelDefinitions = mergeSymbolLabelDefinitionLists(symbolAnnotationDocumentLabels, symbolLabelDefinitions);
    }

    const fallbackLabels = [];
    symbolAnnotations = (payload.annotations || []).map(annotation => {
        let matchingLabel = symbolLabelDefinitions.find(label => label.id === annotation.label_id)
            || symbolLabelDefinitions.find(label => label.slug === annotation.label_slug)
            || symbolLabelDefinitions.find(label => label.name === annotation.label_name);

        if (!matchingLabel && annotation.label_name) {
            matchingLabel = normalizeSymbolLabelDefinition({
                label_id: annotation.label_id,
                name: annotation.label_name,
                slug: annotation.label_slug,
                class_id: annotation.class_id,
                color: annotation.color
            }, getNextSymbolClassId());
            if (matchingLabel) {
                fallbackLabels.push(matchingLabel);
                symbolLabelDefinitions = mergeSymbolLabelDefinitionLists(symbolLabelDefinitions, [matchingLabel]);
            }
        }

        const rect = normalizeWorldRect({
            x: annotation.world_bbox?.x,
            y: annotation.world_bbox?.y,
            width: annotation.world_bbox?.width,
            height: annotation.world_bbox?.height,
        });
        if (!matchingLabel || !rect) {
            return null;
        }
        return createSymbolAnnotation(matchingLabel, rect, {
            id: annotation.annotation_id,
            source: annotation.source,
            matchScore: annotation.match_score,
        });
    }).filter(annotation => annotation && annotation.rect);

    if (fallbackLabels.length) {
        setSymbolAnnotationDocumentLabels(fallbackLabels);
    }
    symbolAnnotationId = Math.max(symbolAnnotations.length, getMaxSymbolAnnotationSerial(symbolAnnotations));

    const selectedStillExists = symbolLabelDefinitions.some(label => label.id === previousSelectedId);
    selectedSymbolLabelId = selectedStillExists
        ? previousSelectedId
        : null;

    if (pageKey) {
        symbolAnnotationActivePageKey = pageKey;
        cacheSymbolAnnotationPagePayload(pageKey, payload);
        if (options.dirty) {
            markSymbolPageDirty(pageKey);
        } else {
            setSymbolPageRevision(pageKey, options.revision ?? getSymbolPageRevision(pageKey));
            markSymbolPageClean(pageKey);
        }
    }

    updateSymbolAnnotationUI();
    if (typeof scheduleDraw === 'function') scheduleDraw();
}

function clearSymbolSearchOverlayArtifacts() {
    anchorBbox = null;
    similarBboxes = [];
    sequenceMatches = [];
    searchBboxSize = null;
    cropPreviewBbox = null;
    cropPreviewTransform = null;
    if (typeof scheduleDraw === 'function') {
        scheduleDraw();
    }
}

async function loadSymbolAnnotationsForCurrentPage(options = {}) {
    syncSymbolAnnotationCacheDocument();

    const pdfName = getCurrentSymbolDocumentName();
    const pageNum = Number(currentPageNum);
    const pageKey = getSymbolPageKey(pdfName, pageNum);
    if (!pageKey) {
        symbolAnnotations = [];
        symbolAnnotationActivePageKey = '';
        if (!options.keepLabels) {
            symbolLabelDefinitions = [];
            selectedSymbolLabelId = null;
        }
        updateSymbolAnnotationUI();
        if (typeof scheduleDraw === 'function') scheduleDraw();
        return null;
    }

    if (isSymbolAnnotationPanelCollapsed && !options.allowWhileCollapsed) {
        cancelSymbolAnnotationPageLoad();
        suspendVisibleSymbolAnnotations({
            clearLabels: false,
            pageKey,
        });
        return null;
    }

    const requestId = ++symbolAnnotationLoadRequestId;

    const cachedPayload = !options.forceRefresh
        ? getCachedSymbolAnnotationPagePayload(pageKey)
        : null;

    if (cachedPayload) {
        if (requestId !== symbolAnnotationLoadRequestId) {
            return null;
        }
        applyLoadedSymbolAnnotationPayload(cachedPayload, { dirty: isSymbolPageDirty(pageKey) });
        if (!options.silent) {
            const count = Array.isArray(cachedPayload.annotations) ? cachedPayload.annotations.length : 0;
            const sourceText = isSymbolPageDirty(pageKey) ? 'bản nháp cục bộ' : 'cache phiên làm việc';
            setSymbolAnnotationFeedback(`Đã mở ${count} bbox từ ${sourceText} cho page ${pageNum}.`, 'info');
        }
        return cachedPayload;
    }

    const sharedLoad = !options.forceRefresh
        ? symbolAnnotationPendingPageLoads.get(pageKey)
        : null;

    if (sharedLoad) {
        try {
            const data = await sharedLoad;
            if (requestId !== symbolAnnotationLoadRequestId) {
                return null;
            }

            applyLoadedSymbolAnnotationPayload(data, { dirty: false });
            if (!options.silent) {
                const count = Array.isArray(data.annotations) ? data.annotations.length : 0;
                setSymbolAnnotationFeedback(`Đã tải ${count} bbox lưu sẵn cho page ${pageNum}.`, 'info');
            }
            return data;
        } catch (error) {
            if (error?.name === 'AbortError') {
                return null;
            }
            if (cachedPayload) {
                applyLoadedSymbolAnnotationPayload(cachedPayload, { dirty: isSymbolPageDirty(pageKey) });
                if (!options.silent) {
                    setSymbolAnnotationFeedback(`Không đọc được DB cho page ${pageNum}, đang dùng cache phiên làm việc.`, 'error');
                }
                return cachedPayload;
            }
            throw error;
        } finally {
            if (requestId === symbolAnnotationLoadRequestId) {
                setSymbolAnnotationLoading(false);
            }
        }
    }

    const url = new URL(`${ENV.API_BASE_URL}/annotations/symbols/page`);
    url.searchParams.set('pdf_name', pdfName);
    url.searchParams.set('page_num', String(pageNum));

    const abortController = typeof AbortController === 'function' ? new AbortController() : null;
    symbolAnnotationLoadAbortController = abortController;

    setSymbolAnnotationLoading(true, `Đang tải annotation cho page ${pageNum}...`);
    const fetchPromise = fetch(url.toString(), abortController ? { signal: abortController.signal } : undefined)
        .then(async response => {
            if (!response.ok) {
                throw new Error(await parseSymbolAnnotationErrorResponse(response));
            }
            return response.json();
        })
        .finally(() => {
            if (symbolAnnotationPendingPageLoads.get(pageKey) === fetchPromise) {
                symbolAnnotationPendingPageLoads.delete(pageKey);
            }
        });
    symbolAnnotationPendingPageLoads.set(pageKey, fetchPromise);
    try {
        const data = await fetchPromise;
        if (requestId !== symbolAnnotationLoadRequestId) {
            return null;
        }

        applyLoadedSymbolAnnotationPayload(data, { dirty: false });
        if (!options.silent) {
            const count = Array.isArray(data.annotations) ? data.annotations.length : 0;
            setSymbolAnnotationFeedback(`Đã tải ${count} bbox lưu sẵn cho page ${pageNum}.`, 'info');
        }
        return data;
    } catch (error) {
        if (abortController?.signal?.aborted || error?.name === 'AbortError') {
            return null;
        }
        if (cachedPayload) {
            applyLoadedSymbolAnnotationPayload(cachedPayload, { dirty: isSymbolPageDirty(pageKey) });
            if (!options.silent) {
                setSymbolAnnotationFeedback(`Không đọc được DB cho page ${pageNum}, đang dùng cache phiên làm việc.`, 'error');
            }
            return cachedPayload;
        }
        throw error;
    } finally {
        if (symbolAnnotationLoadAbortController === abortController) {
            symbolAnnotationLoadAbortController = null;
        }
        if (requestId === symbolAnnotationLoadRequestId) {
            setSymbolAnnotationLoading(false);
        }
    }
}

function resetSymbolAnnotationState(options = {}) {
    clearSymbolAnnotationToolModes();
    symbolAnnotations = [];
    symbolAnnotationId = 0;
    symbolAnnotationFeedbackMessage = '';
    symbolAnnotationFeedbackTone = 'info';
    symbolAnnotationLoadRequestId += 1;
    if (symbolAnnotationLoadAbortController) {
        try {
            symbolAnnotationLoadAbortController.abort();
        } catch (error) {
            console.warn('Failed to abort symbol annotation load during reset:', error);
        }
        symbolAnnotationLoadAbortController = null;
    }
    symbolAnnotationIsLoading = false;
    symbolAnnotationLoadingMessage = 'Đang tải annotation...';
    if (symbolAnnotationPanel) {
        symbolAnnotationPanel.classList.remove('is-loading');
    }
    if (symbolAnnotationLoadingMask) {
        symbolAnnotationLoadingMask.hidden = true;
    }
    if (symbolAnnotationLoadingText) {
        symbolAnnotationLoadingText.textContent = symbolAnnotationLoadingMessage;
    }
    symbolAnnotationActivePageKey = '';
    symbolAnnotationPendingPageLoads = new Map();
    symbolAnnotationPendingSaveKeys = new Set();
    symbolAnnotationQueuedSaveKeys = new Set();
    if (options.clearCache === true) {
        clearSymbolAnnotationPageCache();
        symbolAnnotationCacheDocumentKey = options.keepDocumentKey ? symbolAnnotationCacheDocumentKey : '';
    }
    if (options.clearLabels !== false) {
        symbolLabelDefinitions = mergeSymbolLabelDefinitionLists(symbolAnnotationDocumentLabels);
        selectedSymbolLabelId = null;
    }
    syncSymbolFindButton();
    updateSymbolAnnotationUI();
}

function updateSymbolAnnotationUI() {
    renderSymbolLabelList();
    syncSymbolSimilarityThresholdControl();

    const selectedLabel = getSelectedSymbolLabel();
    const labelCounts = getSymbolLabelCounts();
    const pendingLabelName = getPendingSymbolLabelName();
    const patternReadyCount = getSymbolLabelsWithVectorPatterns().length;
    const canPersist = Boolean(getCurrentSymbolDocumentName() && Number.isFinite(Number(currentPageNum)) && Number(currentPageNum) > 0);
    const currentPageKey = getSymbolPageKey();
    const isDirty = isSymbolPageDirty(currentPageKey);
    const isSaving = Boolean(currentPageKey && symbolAnnotationPendingSaveKeys.has(currentPageKey));
    const isLocked = isSymbolAnnotationInteractionLocked();
    const pageDescriptor = canPersist
        ? `${escapeHtml(getCurrentSymbolDocumentName())} • page ${Number(currentPageNum)}`
        : 'Chưa mở PDF/page';
    const selectedLabelCount = selectedLabel ? (labelCounts.get(selectedLabel.id) || 0) : null;
    const visibleAnnotationCount = selectedLabelCount ?? symbolAnnotations.length;
    const summaryParts = [];
    if (selectedLabel?.name) {
        summaryParts.push(selectedLabel.name);
        summaryParts.push(`${visibleAnnotationCount} bbox`);
    } else if (pendingLabelName) {
        summaryParts.push(`+ ${pendingLabelName}`);
        summaryParts.push(`${symbolAnnotations.length} bbox`);
    } else {
        summaryParts.push(`${symbolAnnotations.length} bbox`);
    }
    if (canPersist) {
        if (symbolAnnotationIsLoading) {
            summaryParts.push('Đang tải');
        } else if (isSaving) {
            summaryParts.push('Đang lưu');
        } else if (isDirty) {
            summaryParts.push('Chưa lưu');
        } else {
            summaryParts.push('Đã lưu');
        }
    }
    const feedbackText = symbolAnnotationFeedbackMessage
        ? `<strong>${pageDescriptor}</strong><br>${escapeHtml(summaryParts.join(' • '))}<br>${escapeHtml(symbolAnnotationFeedbackMessage)}`
        : `<strong>${pageDescriptor}</strong><br>${escapeHtml(summaryParts.join(' • '))}`;

    if (symbolAnnotationStatus) {
        symbolAnnotationStatus.classList.remove('is-error', 'is-success');
        if (symbolAnnotationFeedbackTone === 'error') {
            symbolAnnotationStatus.classList.add('is-error');
        } else if (symbolAnnotationFeedbackTone === 'success') {
            symbolAnnotationStatus.classList.add('is-success');
        }
        symbolAnnotationStatus.innerHTML = feedbackText;
    }

    if (symbolAnnotationCountBadge) {
        symbolAnnotationCountBadge.textContent = String(visibleAnnotationCount);
    }
    if (symbolAnnotationSaveBadge) {
        symbolAnnotationSaveBadge.classList.remove('is-clean', 'is-dirty', 'is-saving');
        if (isSaving) {
            symbolAnnotationSaveBadge.textContent = 'Đang lưu';
            symbolAnnotationSaveBadge.classList.add('is-saving');
        } else if (isDirty) {
            symbolAnnotationSaveBadge.textContent = 'Chưa lưu';
            symbolAnnotationSaveBadge.classList.add('is-dirty');
        } else {
            symbolAnnotationSaveBadge.textContent = 'Đã lưu';
            symbolAnnotationSaveBadge.classList.add('is-clean');
        }
    }

    if (btnAddSymbolLabel) {
        btnAddSymbolLabel.disabled = !pendingLabelName || isLocked;
    }

    if (btnSymbolDrawMatch) {
        btnSymbolDrawMatch.disabled = isLocked || !jsonShapes || !jsonShapes.length || (!selectedLabel && !pendingLabelName);
    }
    if (btnSymbolDeleteByBbox) {
        btnSymbolDeleteByBbox.disabled = isLocked || !jsonShapes || !jsonShapes.length || !symbolAnnotations.length;
    }
    if (btnSymbolAutoFindPage) {
        btnSymbolAutoFindPage.disabled = isLocked || symbolAnnotationAutoFindInProgress || !jsonShapes || !jsonShapes.length || patternReadyCount === 0;
        btnSymbolAutoFindPage.textContent = symbolAnnotationAutoFindInProgress
            ? 'Đang tìm'
            : (patternReadyCount > 0 ? `Tìm tất cả (${patternReadyCount})` : 'Tìm tất cả');
    }
    if (btnSymbolExportDataset) {
        const canExportDataset = Boolean(currentPdfFile && canPersist);
        btnSymbolExportDataset.disabled = isLocked || symbolAnnotationExportInProgress || !canExportDataset;
        btnSymbolExportDataset.textContent = symbolAnnotationExportInProgress ? 'Đang export' : 'Export';
    }
    if (symbolSimilarityThresholdInput) {
        symbolSimilarityThresholdInput.disabled = isLocked;
    }
    if (btnSymbolSavePage) {
        btnSymbolSavePage.disabled = !canPersist || !isDirty || isLocked;
        btnSymbolSavePage.textContent = isSaving ? 'Đang lưu...' : 'Lưu DB';
        btnSymbolSavePage.classList.toggle('is-muted', isDirty && !isSaving);
    }
    if (btnSymbolReloadPage) {
        btnSymbolReloadPage.disabled = !canPersist || isLocked;
    }
    if (btnSymbolClearPage) {
        btnSymbolClearPage.disabled = !symbolAnnotations.length || isLocked;
    }
    if (symbolLabelNameInput) {
        symbolLabelNameInput.disabled = isLocked;
    }
    syncSymbolFindButton();
}

function deactivateSymbolFindArming() {
    isSymbolFindArmed = false;
    updateSymbolAnnotationUI();
}

function deactivateSymbolDeleteArming() {
    isSymbolDeleteArmed = false;
    updateSymbolAnnotationUI();
}

function activateSymbolFindArming() {
    if (symbolAnnotationIsLoading) {
        setSymbolAnnotationFeedback('Đang tải annotation từ DB. Hãy chờ tải xong trước khi vẽ.', 'info');
        return;
    }
    if (!jsonShapes || !jsonShapes.length) {
        setSymbolAnnotationFeedback('Cần mở một trang PDF trước khi gán nhãn bbox.', 'error');
        return;
    }

    const label = ensureSymbolLabelReadyForDraw();
    if (!label) {
        setSymbolAnnotationFeedback('Hãy nhập tên hoặc chọn một nhãn trước khi dùng Find.', 'error');
        return;
    }

    isSymbolDeleteArmed = false;
    isSymbolFindArmed = true;
    symbolAnnotationFeedbackMessage = '';
    symbolAnnotationFeedbackTone = 'info';
    updateSymbolAnnotationUI();

    if (!isDrawingBbox && btnDrawBbox) {
        btnDrawBbox.click();
    }
    if (typeof updateModeLabel === 'function') {
        updateModeLabel('symbol');
    }
}

function activateSymbolDeleteArming() {
    if (symbolAnnotationIsLoading) {
        setSymbolAnnotationFeedback('Đang tải annotation từ DB. Hãy chờ tải xong trước khi xóa.', 'info');
        return;
    }
    if (!jsonShapes || !jsonShapes.length) {
        setSymbolAnnotationFeedback('Cần mở một trang PDF trước khi xóa annotation bằng bbox.', 'error');
        return;
    }
    if (!symbolAnnotations.length) {
        setSymbolAnnotationFeedback('Page hiện tại chưa có annotation để xóa.', 'info');
        return;
    }

    isSymbolFindArmed = false;
    isSymbolDeleteArmed = true;
    symbolAnnotationFeedbackMessage = '';
    symbolAnnotationFeedbackTone = 'info';
    updateSymbolAnnotationUI();

    if (!isDrawingBbox && btnDrawBbox) {
        btnDrawBbox.click();
    }
    if (typeof updateModeLabel === 'function') {
        updateModeLabel('symbol');
    }
}

function toggleSymbolFindArming() {
    if (isSymbolFindArmed) {
        if (isDrawingBbox && btnDrawBbox) {
            btnDrawBbox.click();
        }
        deactivateSymbolFindArming();
        setSymbolAnnotationFeedback('Đã hủy thao tác vẽ bbox cho annotation.', 'info');
        return;
    }
    activateSymbolFindArming();
}

function toggleSymbolDeleteArming() {
    if (isSymbolDeleteArmed) {
        if (isDrawingBbox && btnDrawBbox) {
            btnDrawBbox.click();
        }
        deactivateSymbolDeleteArming();
        setSymbolAnnotationFeedback('Đã hủy thao tác xóa annotation bằng bbox.', 'info');
        return;
    }
    activateSymbolDeleteArming();
}

async function handleSymbolDeleteBboxSelectionComplete(selectionRect) {
    if (!isSymbolDeleteArmed) {
        return;
    }

    deactivateSymbolDeleteArming();
    await deleteSymbolAnnotationsBySelectionRect(selectionRect);
}

async function handleSymbolBboxSelectionComplete(searchSummary) {
    if (!isSymbolFindArmed) {
        return;
    }

    const selectedLabel = getSelectedSymbolLabel();
    if (!selectedLabel) {
        setSymbolAnnotationFeedback('Không còn nhãn đang chọn để gắn bbox.', 'error');
        return;
    }

    const capturedPattern = normalizeSymbolVectorPattern(searchSummary?.pattern);
    const didAttachPattern = attachSymbolVectorPatternToLabel(selectedLabel.id, capturedPattern);

    const resultRects = Array.isArray(searchSummary?.allResults) ? searchSummary.allResults : [];
    const candidateRects = resultRects
        .map(rect => normalizeWorldRect(rect))
        .filter(Boolean);
    const uniqueRects = [];
    const rectKeys = new Set();
    candidateRects.forEach(rect => {
        const key = roundRectKey(rect);
        if (rectKeys.has(key)) return;
        rectKeys.add(key);
        uniqueRects.push(rect);
    });

    if (!uniqueRects.length) {
        deactivateSymbolFindArming();
        if (didAttachPattern) {
            persistCurrentSymbolAnnotationState();
            setSymbolAnnotationFeedback(`Đã lưu pattern vector cho nhãn ${selectedLabel.name}, nhưng chưa tìm thấy bbox hợp lệ. Đang tự động lưu DB...`, 'info');
            try {
                await saveSymbolAnnotationsForCurrentPage({ silent: true });
                setSymbolAnnotationFeedback(`Đã lưu pattern vector cho nhãn ${selectedLabel.name}.`, 'success');
            } catch (error) {
                console.error('Failed to auto-save symbol label pattern:', error);
                setSymbolAnnotationFeedback(`Đã lưu pattern trên FE nhưng ghi DB thất bại: ${error.message}`, 'error');
            }
            return;
        }
        setSymbolAnnotationFeedback('Find chưa trả về bbox nào hợp lệ để lưu annotation.', 'error');
        return;
    }

    const incoming = uniqueRects.map(rect => {
        const matchedResult = resultRects.find(result => getRectIoU(rect, result) >= 0.999) || null;
        return createSymbolAnnotation(selectedLabel, rect, {
            source: matchedResult?.source || 'similar',
            matchScore: Number.isFinite(matchedResult?.score) ? Number(matchedResult.score) : null,
        });
    });
    const addedCount = mergeSymbolAnnotations(incoming);
    clearSymbolSearchOverlayArtifacts();
    deactivateSymbolFindArming();
    setSymbolAnnotationFeedback(`Đã gắn nhãn ${selectedLabel.name} cho ${addedCount} bbox. Đang tự động lưu DB...`, 'info');
    try {
        await saveSymbolAnnotationsForCurrentPage({ silent: true });
        setSymbolAnnotationFeedback(`Đã gắn nhãn ${selectedLabel.name} cho ${addedCount} bbox. Save DB thành công.`, 'success');
    } catch (error) {
        console.error('Failed to auto-save symbol annotations:', error);
        setSymbolAnnotationFeedback(`Đã gắn nhãn nhưng tự động lưu DB thất bại: ${error.message}`, 'error');
    }
}

function collectUniqueSymbolSearchEntries(resultRects) {
    const uniqueEntries = [];
    const rectKeys = new Set();
    (Array.isArray(resultRects) ? resultRects : []).forEach(result => {
        const rect = normalizeWorldRect(result);
        if (!rect) return;
        const key = roundRectKey(rect);
        if (rectKeys.has(key)) return;
        rectKeys.add(key);
        uniqueEntries.push({ rect, result });
    });
    return uniqueEntries;
}

async function autoFindSymbolAnnotationsForCurrentPage() {
    if (symbolAnnotationIsLoading || symbolAnnotationAutoFindInProgress) {
        return;
    }
    if (!jsonShapes || !jsonShapes.length) {
        setSymbolAnnotationFeedback('Cần mở một page PDF trước khi tìm tự động.', 'error');
        return;
    }
    if (typeof runSavedPatternSearch !== 'function') {
        setSymbolAnnotationFeedback('Chưa có hàm search pattern để tìm tự động.', 'error');
        return;
    }

    try {
        await loadSymbolAnnotationDocumentSummary({ silent: true });
    } catch (error) {
        console.warn('Failed to refresh symbol labels before auto-find:', error);
    }

    const labelsWithPatterns = getSymbolLabelsWithVectorPatterns();
    if (!labelsWithPatterns.length) {
        setSymbolAnnotationFeedback('Chưa có label nào có pattern vector. Hãy vẽ bbox và Search một lần để lưu pattern cho label.', 'info');
        return;
    }

    symbolAnnotationAutoFindInProgress = true;
    setSymbolAnnotationLoading(true, `Đang tìm ${labelsWithPatterns.length} label trên page hiện tại...`);

    const incomingAnnotations = [];
    const seenAnnotationKeys = new Set();

    try {
        for (let index = 0; index < labelsWithPatterns.length; index += 1) {
            const label = labelsWithPatterns[index];
            setSymbolAnnotationLoading(true, `Đang tìm ${label.name} (${index + 1}/${labelsWithPatterns.length})...`);
            const searchSummary = await runSavedPatternSearch(label.vectorPattern, {
                similarityThreshold: getSymbolSimilarityThresholdRatio(),
                showLoading: false,
                draw: false,
            });

            collectUniqueSymbolSearchEntries(searchSummary?.allResults).forEach(({ rect, result }) => {
                const annotationKey = `${label.id}|${roundRectKey(rect)}`;
                if (seenAnnotationKeys.has(annotationKey)) return;
                seenAnnotationKeys.add(annotationKey);
                incomingAnnotations.push(createSymbolAnnotation(label, rect, {
                    source: result?.source || 'auto_pattern',
                    matchScore: Number.isFinite(result?.score) ? Number(result.score) : null,
                }));
            });

            if (typeof yieldToBrowser === 'function') {
                await yieldToBrowser();
            }
        }

        clearSymbolSearchOverlayArtifacts();
        if (!incomingAnnotations.length) {
            setSymbolAnnotationFeedback(`Đã chạy ${labelsWithPatterns.length} pattern nhưng không tìm thấy bbox mới trên page hiện tại.`, 'info');
            return;
        }

        const addedCount = mergeSymbolAnnotations(incomingAnnotations);
        setSymbolAnnotationFeedback(`Đã tìm tự động ${addedCount} bbox từ ${labelsWithPatterns.length} label. Đang tự động lưu DB...`, 'info');
        await saveSymbolAnnotationsForCurrentPage({ silent: true });
        setSymbolAnnotationFeedback(`Đã tìm tự động ${addedCount} bbox và lưu DB thành công.`, 'success');
    } catch (error) {
        console.error('Symbol auto-find failed:', error);
        setSymbolAnnotationFeedback(`Tìm tự động thất bại: ${error.message}`, 'error');
    } finally {
        symbolAnnotationAutoFindInProgress = false;
        setSymbolAnnotationLoading(false);
        clearSymbolSearchOverlayArtifacts();
        updateSymbolAnnotationUI();
    }
}

function getSymbolFindSelectionOptions() {
    const selectedLabel = getSelectedSymbolLabel();
    if (!isSymbolFindArmed || symbolAnnotationIsLoading || !selectedLabel) {
        return null;
    }
    return {
        patternName: selectedLabel.name,
        similarityThreshold: getSymbolSimilarityThresholdRatio(),
        onSearchComplete(searchSummary) {
            void handleSymbolBboxSelectionComplete(searchSummary);
        }
    };
}

function getSymbolDeleteSelectionOptions() {
    if (!isSymbolDeleteArmed || symbolAnnotationIsLoading) {
        return null;
    }
    return {
        onDeleteSelection(selectionRect) {
            void handleSymbolDeleteBboxSelectionComplete(selectionRect);
        }
    };
}

function drawSymbolAnnotationOverlays(targetCtx) {
    if (isSymbolAnnotationPanelCollapsed) return;
    if (!Array.isArray(symbolAnnotations) || !symbolAnnotations.length) return;

    targetCtx.save();
    targetCtx.lineJoin = 'round';

    symbolAnnotations.forEach(annotation => {
        const rect = annotation.rect;
        const color = resolveSymbolAnnotationColor(annotation);
        targetCtx.strokeStyle = color;
        targetCtx.lineWidth = 2 / Math.max(zoom, 0.01);
        targetCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);

        const fontSize = 12 / Math.max(zoom, 0.01);
        const padding = 4 / Math.max(zoom, 0.01);
        const confidenceText = Number.isFinite(annotation.matchScore)
            ? ` ${(annotation.matchScore * 100).toFixed(0)}%`
            : '';
        const text = `${annotation.labelName}${confidenceText}`;
        targetCtx.font = `700 ${fontSize}px Arial`;
        const textWidth = targetCtx.measureText(text).width;
        const labelHeight = fontSize + (padding * 1.4);
        const labelY = Math.max(0, rect.y - labelHeight);

        targetCtx.fillStyle = color;
        targetCtx.fillRect(rect.x, labelY, textWidth + (padding * 2), labelHeight);
        targetCtx.fillStyle = '#ffffff';
        targetCtx.fillText(text, rect.x + padding, labelY + fontSize);
    });

    targetCtx.restore();
}

async function handleSymbolDocumentLoaded() {
    const previousPageKey = symbolAnnotationActivePageKey;
    const nextPageKey = getSymbolPageKey();
    let flushError = null;

    if (previousPageKey && previousPageKey !== nextPageKey && isSymbolPageDirty(previousPageKey)) {
        try {
            await saveDirtySymbolAnnotationPage(previousPageKey, { silent: true });
        } catch (error) {
            console.warn('Failed to persist previous symbol annotation page:', error);
            flushError = error;
        }
    }

    if (!getCurrentSymbolDocumentName() || !currentPageNum) {
        symbolAnnotations = [];
        symbolAnnotationActivePageKey = '';
        updateSymbolAnnotationUI();
        if (typeof scheduleDraw === 'function') scheduleDraw();
        return;
    }

    if (isSymbolAnnotationPanelCollapsed) {
        suspendVisibleSymbolAnnotations({ clearLabels: false, pageKey: nextPageKey });
        if (flushError) {
            setSymbolAnnotationFeedback(`Page trước chưa lưu được vào DB: ${flushError.message}`, 'error');
        }
        return;
    }

    try {
        try {
            await loadSymbolAnnotationDocumentSummary({ silent: true });
        } catch (summaryError) {
            console.warn('Failed to load symbol annotation document summary:', summaryError);
        }
        await loadSymbolAnnotationsForCurrentPage({ silent: true, keepLabels: true });
        if (flushError) {
            setSymbolAnnotationFeedback(`Page trước chưa lưu được vào DB: ${flushError.message}`, 'error');
        }
    } catch (error) {
        console.warn('Failed to load symbol annotations:', error);
        symbolAnnotations = [];
        updateSymbolAnnotationUI();
        if (typeof scheduleDraw === 'function') scheduleDraw();
        if (flushError) {
            setSymbolAnnotationFeedback(`Page trước chưa lưu được vào DB: ${flushError.message}`, 'error');
        }
    }
}

if (symbolAnnotationPanel) {
    ['mousedown', 'mouseup', 'mousemove', 'wheel', 'contextmenu'].forEach(eventName => {
        symbolAnnotationPanel.addEventListener(eventName, event => {
            event.stopPropagation();
            if (eventName === 'contextmenu') {
                event.preventDefault();
            }
        });
    });
}

if (btnAddSymbolLabel) {
    btnAddSymbolLabel.addEventListener('click', () => {
        const label = addSymbolLabel(symbolLabelNameInput?.value || '');
        if (!label) return;
        if (symbolLabelNameInput) {
            symbolLabelNameInput.value = '';
            symbolLabelNameInput.focus();
        }
        activateSymbolFindArming();
    });
}

if (symbolLabelNameInput) {
    symbolLabelNameInput.addEventListener('input', () => {
        updateSymbolAnnotationUI();
    });
    symbolLabelNameInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            btnAddSymbolLabel?.click();
        }
    });
}

if (btnSymbolDrawMatch) {
    btnSymbolDrawMatch.addEventListener('click', toggleSymbolFindArming);
}

if (btnSymbolDeleteByBbox) {
    btnSymbolDeleteByBbox.addEventListener('click', toggleSymbolDeleteArming);
}

if (btnSymbolAutoFindPage) {
    btnSymbolAutoFindPage.addEventListener('click', () => {
        void autoFindSymbolAnnotationsForCurrentPage();
    });
}

if (btnSymbolExportDataset) {
    btnSymbolExportDataset.addEventListener('click', async () => {
        try {
            await exportSymbolAnnotationsDatasetForCurrentPage();
        } catch (error) {
            console.error('Failed to export symbol annotation dataset:', error);
            setSymbolAnnotationFeedback(`Export dataset thất bại: ${error.message}`, 'error');
        }
    });
}

if (symbolSimilarityThresholdInput) {
    symbolSimilarityThresholdInput.addEventListener('input', () => {
        setSymbolSimilarityThreshold(symbolSimilarityThresholdInput.value, { silent: true });
        updateSymbolAnnotationUI();
    });
    symbolSimilarityThresholdInput.addEventListener('change', () => {
        setSymbolSimilarityThreshold(symbolSimilarityThresholdInput.value);
    });
}

if (btnToggleSymbolAnnotationPanel) {
    btnToggleSymbolAnnotationPanel.addEventListener('click', async () => {
        const nextCollapsed = !isSymbolAnnotationPanelCollapsed;
        applySymbolAnnotationPanelState(nextCollapsed);
        if (nextCollapsed) {
            return;
        }
        try {
            await loadSymbolAnnotationDocumentSummary({ silent: true });
            await loadSymbolAnnotationsForCurrentPage({ silent: true, keepLabels: true });
        } catch (error) {
            console.error('Failed to load symbol annotations after expanding panel:', error);
            setSymbolAnnotationFeedback(`Tải annotation thất bại: ${error.message}`, 'error');
        }
    });
}

if (btnSymbolSavePage) {
    btnSymbolSavePage.addEventListener('click', async () => {
        try {
            await saveSymbolAnnotationsForCurrentPage();
        } catch (error) {
            console.error('Failed to save symbol annotations:', error);
            setSymbolAnnotationFeedback(`Lưu DB thất bại: ${error.message}`, 'error');
        }
    });
}

if (btnSymbolReloadPage) {
    btnSymbolReloadPage.addEventListener('click', async () => {
        try {
            if (isSymbolPageDirty(getSymbolPageKey()) && !window.confirm('Trang hiện tại có thay đổi chưa lưu. Tải lại từ DB sẽ bỏ các thay đổi cục bộ của trang này.')) {
                return;
            }
            await loadSymbolAnnotationsForCurrentPage({ forceRefresh: true });
        } catch (error) {
            console.error('Failed to reload symbol annotations:', error);
            setSymbolAnnotationFeedback(`Tải dữ liệu lưu sẵn thất bại: ${error.message}`, 'error');
        }
    });
}

if (btnSymbolClearPage) {
    btnSymbolClearPage.addEventListener('click', async () => {
        if (!symbolAnnotations.length) return;
        if (!window.confirm(`Xóa toàn bộ ${symbolAnnotations.length} bbox annotation của page hiện tại?`)) {
            setSymbolAnnotationFeedback('Đã hủy xóa toàn bộ annotation của page.', 'info');
            return;
        }
        symbolAnnotations = [];
        persistCurrentSymbolAnnotationState();
        updateSymbolAnnotationUI();
        if (typeof scheduleDraw === 'function') scheduleDraw();
        setSymbolAnnotationFeedback('Đã xóa toàn bộ symbol annotation của trang hiện tại. Đang tự động lưu DB...', 'info');
        try {
            await saveSymbolAnnotationsForCurrentPage({ silent: true });
            setSymbolAnnotationFeedback('Đã xóa toàn bộ symbol annotation của trang hiện tại. Save DB thành công.', 'success');
        } catch (error) {
            console.error('Failed to auto-save cleared symbol annotations:', error);
            setSymbolAnnotationFeedback(`Đã xóa trên FE nhưng tự động lưu DB thất bại: ${error.message}`, 'error');
        }
    });
}

window.addEventListener('beforeunload', event => {
    if (!symbolAnnotationDirtyPageKeys.size) {
        return;
    }
    event.preventDefault();
    event.returnValue = '';
});

try {
    const storedCollapsed = localStorage.getItem('visual_pdf_object.symbol_annotation_collapsed');
    applySymbolAnnotationPanelState(storedCollapsed !== '0');
} catch (error) {
    applySymbolAnnotationPanelState(true);
}

setSymbolSimilarityThreshold(symbolAnnotationSimilarityThreshold, { silent: true, persist: false });
updateSymbolAnnotationUI();