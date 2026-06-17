// layer_controls.js
// Layer Controls (giữ nguyên)
let pendingLayerListRenderToken = 0;

function resetLayerInteractionState() {
    isInteracting = false;
    if (interactionTimer) {
        clearTimeout(interactionTimer);
        interactionTimer = null;
    }
}

function applyLayerVisibilityUpdate(options = {}) {
    resetLayerInteractionState();
    if (typeof invalidateShapeRasterCache === 'function') {
        invalidateShapeRasterCache();
        scheduleShapeRasterCacheBuild();
    }
    if (typeof invalidateSnapPointIndex === 'function') {
        invalidateSnapPointIndex();
        if ((annotationMode === 'connect' || annotationMode === 'junction') && typeof scheduleSnapPointIndexWarmup === 'function') {
            scheduleSnapPointIndexWarmup();
        }
    }
    if (options.refreshList) {
        updateLayerList();
    }
    scheduleDraw();
    applySvgTransform();
    if (typeof updateDetectionExtractUI === 'function') {
        updateDetectionExtractUI();
    }
}

function getShapeLayerNamesForCurrentMode() {
    return sortedLayerKeys.filter(layerName => {
        const isDefaultShapeLayer = layerName === '__default_shape_layer__';
        return layerName.startsWith('shape_')
            || isDefaultShapeLayer
            || (
                currentLayerField === 'layer'
                && !layerName.startsWith('svg_')
                && !pipelineLayerNames.includes(layerName)
                && !detectionLayerNames.includes(layerName)
            );
    });
}

function getLayerVisualMeta(layerName) {
    if (layerName === 'svg_text') {
        return { color: '#444', type: 'text' };
    }
    if (layerName === 'svg_graphic') {
        return { color: '#222', type: 'shape' };
    }

    const layerObjs = layerIndex[layerName];
    if (!Array.isArray(layerObjs) || !layerObjs.length) {
        return { color: '#888', type: 'shape' };
    }

    const firstObj = layerObjs[0];
    return {
        color: firstObj._strokeStyle || toRgbString(firstObj.color),
        type: firstObj.fill ? 'filled' : 'shape'
    };
}

function parseColorChannels(colorValue) {
    if (typeof colorValue !== 'string') return null;

    const normalized = colorValue.trim();
    const hexMatch = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
        const hex = hexMatch[1];
        if (hex.length === 3) {
            return hex.split('').map(channel => parseInt(channel + channel, 16));
        }
        return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16)
        ];
    }

    const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/i);
    if (!rgbMatch) return null;

    const channels = rgbMatch[1]
        .split(',')
        .slice(0, 3)
        .map(channel => Number.parseFloat(channel.trim()));

    return channels.length === 3 && channels.every(Number.isFinite)
        ? channels
        : null;
}

function getPerceivedLayerBrightness(layerName) {
    const colorChannels = parseColorChannels(getLayerVisualMeta(layerName).color);
    if (!colorChannels) return Infinity;

    const [red, green, blue] = colorChannels.map(channel => Math.max(0, Math.min(255, channel)) / 255);
    return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function getNormalizedLayerColorKey(layerName) {
    const colorChannels = parseColorChannels(getLayerVisualMeta(layerName).color);
    if (!colorChannels) return null;
    return colorChannels
        .slice(0, 3)
        .map(channel => Math.max(0, Math.min(255, Math.round(channel))))
        .join(',');
}

function getMainShapeColorGroup() {
    const shapeLayers = getShapeLayerNamesForCurrentMode();
    if (!shapeLayers.length) return null;

    const colorGroups = new Map();
    shapeLayers.forEach(layerName => {
        const colorKey = getNormalizedLayerColorKey(layerName);
        if (!colorKey) return;

        const existingGroup = colorGroups.get(colorKey);
        if (existingGroup) {
            existingGroup.layerNames.push(layerName);
            existingGroup.totalCommandCount += totalCommands[layerName] || 0;
            return;
        }

        colorGroups.set(colorKey, {
            colorKey,
            displayColor: getLayerVisualMeta(layerName).color,
            brightness: getPerceivedLayerBrightness(layerName),
            totalCommandCount: totalCommands[layerName] || 0,
            layerNames: [layerName]
        });
    });

    if (!colorGroups.size) return null;

    return Array.from(colorGroups.values())
        .sort((left, right) => {
            const brightnessDelta = left.brightness - right.brightness;
            if (Math.abs(brightnessDelta) > 1e-6) {
                return brightnessDelta;
            }

            const commandDelta = right.totalCommandCount - left.totalCommandCount;
            if (commandDelta !== 0) {
                return commandDelta;
            }

            return left.colorKey.localeCompare(right.colorKey);
        })[0] || null;
}

function getMainLayerMinElementCount() {
    const value = Number(CONFIG.MAIN_LAYER_MIN_ELEMENTS);
    return Number.isFinite(value) && value >= 0 ? value : 100;
}

function isMainLayerExcludedGrayOrWhiteCandidate(layerName) {
    const channels = parseColorChannels(getLayerVisualMeta(layerName).color);
    if (!channels) return false;

    const clamped = channels
        .slice(0, 3)
        .map(channel => Math.max(0, Math.min(255, Math.round(Number(channel) || 0))));
    return clamped.length === 3
        && clamped[0] === clamped[1]
        && clamped[1] === clamped[2]
        && clamped[0] !== 0;
}

function getMainLayerCandidateLayerNames() {
    const minElements = getMainLayerMinElementCount();
    return getShapeLayerNamesForCurrentMode()
        .filter(layerName => {
            const elementCount = Number(totalCommands[layerName] || 0);
            return elementCount > minElements
                && !isMainLayerExcludedGrayOrWhiteCandidate(layerName)
                && Array.isArray(layerIndex[layerName])
                && layerIndex[layerName].length > 0;
        });
}

function getCurrentMainLayerDocumentName() {
    return (currentPdfFile && currentPdfFile.name)
        || (currentJsonSourceFile && (currentJsonSourceFile.name || String(currentJsonSourceFile)))
        || 'visual_layers';
}

function getCurrentMainLayerDocumentKey() {
    if (currentPdfFile) {
        const sourceKey = typeof getPdfSourceKey === 'function'
            ? getPdfSourceKey(currentPdfFile)
            : `${currentPdfFile.name}:${currentPdfFile.size}:${currentPdfFile.lastModified}`;
        return `pdf:${sourceKey}`;
    }
    if (currentJsonSourceFile) {
        return `json:${currentJsonSourceFile.name || String(currentJsonSourceFile)}:${currentJsonSourceFile.size || 0}:${currentJsonSourceFile.lastModified || 0}`;
    }
    return `memory:${getCurrentMainLayerDocumentName()}`;
}

function resetMainLayerClassificationCache(documentKey = getCurrentMainLayerDocumentKey()) {
    mainLayerClassificationDocumentKey = documentKey;
    mainLayerClassificationCache = new Map();
    mainLayerClassificationRequestToken += 1;
    mainLayers = null;
}

function syncMainLayerClassificationDocumentCache() {
    const documentKey = getCurrentMainLayerDocumentKey();
    if (mainLayerClassificationDocumentKey !== documentKey) {
        resetMainLayerClassificationCache(documentKey);
    }
    return documentKey;
}

function getMainLayerPageCacheKey(pageNum = currentPageNum) {
    const documentKey = syncMainLayerClassificationDocumentCache();
    const safePageNum = Number.isInteger(Number(pageNum)) && Number(pageNum) >= 1 ? Number(pageNum) : 1;
    return `${documentKey}|p:${safePageNum}|mode:${currentLayerField}`;
}

function buildMainLayerCandidateSignature(layerNames, pageKey) {
    const layerPart = (layerNames || [])
        .map(layerName => `${layerName}:${Number(totalCommands[layerName] || 0)}`)
        .join('|');
    return `${pageKey || ''}|${layerPart}`;
}

function getMainLayerEntryForCurrentPage() {
    if (!hasRenderableDocument()) return null;
    return mainLayerClassificationCache.get(getMainLayerPageCacheKey()) || null;
}

function isMainLayerClassificationStillCurrent(pageKey) {
    return Boolean(hasRenderableDocument() && getMainLayerPageCacheKey() === pageKey);
}

function isMainLayerClassificationRequestStillCurrent(pageKey, requestToken) {
    return Boolean(
        mainLayerClassificationRequestToken === requestToken &&
        isMainLayerClassificationStillCurrent(pageKey)
    );
}

function cancelCurrentMainLayerClassificationWork() {
    mainLayerClassificationRequestToken += 1;
}

function createMainLayerAbortError(message = 'Main layer classification was superseded by a newer page.') {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

function getMainLayerTop1(result) {
    const rawTop1 = result?.top1 ?? result?.probs?.top1 ?? result?.result?.probs?.top1;
    const top1 = Number(rawTop1);
    return Number.isInteger(top1) ? top1 : null;
}

function getMainLayerConfidence(result) {
    const confidence = Number(result?.top1conf ?? result?.probs?.top1conf ?? result?.result?.probs?.top1conf);
    return Number.isFinite(confidence) ? confidence : null;
}

function formatMainLayerConfidence(result) {
    const confidence = getMainLayerConfidence(result);
    if (confidence === null) return '';
    return `${(confidence * 100).toFixed(confidence >= 0.995 ? 2 : 1)}%`;
}

function getMainLayerDebugResult(layerName) {
    const entry = getMainLayerEntryForCurrentPage();
    if (!entry || entry.status !== 'ready' || !entry.resultByLayer) return null;
    return entry.resultByLayer.get(layerName) || null;
}

function createMainLayerConfidenceBadge(layerName) {
    const result = getMainLayerDebugResult(layerName);
    if (!result) return null;

    const badge = document.createElement('span');
    const isMain = Boolean(result.is_main_layer || getMainLayerTop1(result) === 0);
    const confidenceText = formatMainLayerConfidence(result);
    badge.className = `main-layer-confidence-badge ${isMain ? 'is-main' : 'is-normal'}`;
    badge.textContent = confidenceText || '--%';
    badge.title = `${layerName}: top1=${getMainLayerTop1(result)} ${confidenceText || ''}${result.cache_hit ? ' (DB cache)' : ''}`.trim();
    return badge;
}

function blobToBase64Payload(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = String(reader.result || '');
            resolve(dataUrl.includes(',') ? dataUrl.split(',', 2)[1] : dataUrl);
        };
        reader.onerror = () => reject(reader.error || new Error('Cannot read image blob.'));
        reader.readAsDataURL(blob);
    });
}

async function canvasToMainLayerBase64(canvasElement) {
    if (typeof canvasToBlobAsync === 'function') {
        const blob = await canvasToBlobAsync(canvasElement, 'image/png');
        return blobToBase64Payload(blob);
    }
    if (typeof canvasToBase64 === 'function') {
        return canvasToBase64(canvasElement, 'image/png');
    }
    return canvasElement.toDataURL('image/png').split(',', 2)[1];
}

async function renderMainLayerCandidateImages(layerNames, pageKey = null, requestToken = null) {
    const scale = Number(CONFIG.MAIN_LAYER_RENDER_SCALE) || 1;
    if (typeof getExportBounds !== 'function' || typeof renderLayerOnExportCanvas !== 'function' || typeof createCanvas !== 'function') {
        throw new Error('Layer image renderer is not ready.');
    }

    if (pageKey && requestToken !== null && !isMainLayerClassificationRequestStillCurrent(pageKey, requestToken)) {
        throw createMainLayerAbortError();
    }
    if (pageKey && requestToken === null && !isMainLayerClassificationStillCurrent(pageKey)) {
        throw createMainLayerAbortError();
    }

    const bounds = await getExportBounds(scale);
    if (pageKey && requestToken !== null && !isMainLayerClassificationRequestStillCurrent(pageKey, requestToken)) {
        throw createMainLayerAbortError();
    }
    if (pageKey && requestToken === null && !isMainLayerClassificationStillCurrent(pageKey)) {
        throw createMainLayerAbortError();
    }
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
        throw new Error('Cannot determine page bounds for main-layer classification.');
    }

    const imageWidth = Math.max(1, Math.round(bounds.width * scale));
    const imageHeight = Math.max(1, Math.round(bounds.height * scale));
    const { canvas: exportCanvas, ctx: exportCtx } = createCanvas(imageWidth, imageHeight);
    const layers = [];

    for (const layerName of layerNames) {
        if (pageKey && requestToken !== null && !isMainLayerClassificationRequestStillCurrent(pageKey, requestToken)) {
            throw createMainLayerAbortError();
        }
        if (pageKey && requestToken === null && !isMainLayerClassificationStillCurrent(pageKey)) {
            throw createMainLayerAbortError();
        }
        await renderLayerOnExportCanvas(exportCtx, exportCanvas, layerName, bounds, scale);
        layers.push({
            layer_name: layerName,
            element_count: Number(totalCommands[layerName] || 0),
            color: getLayerVisualMeta(layerName).color,
            image_mime: 'image/png',
            image_width: imageWidth,
            image_height: imageHeight,
            image_b64: await canvasToMainLayerBase64(exportCanvas)
        });
        await yieldToBrowser();
    }

    return layers;
}

function normalizeMainLayerClassificationResponse(data, candidateLayerNames, candidateSignature, pageKey, documentKey, pageNum) {
    const results = Array.isArray(data?.results) ? data.results : [];
    const resultByLayer = new Map();
    results.forEach(result => {
        if (result?.layer_name) {
            resultByLayer.set(result.layer_name, result);
        }
    });

    const fireLayers = results
        .filter(result => result?.layer_name && (result.is_main_layer || getMainLayerTop1(result) === 0))
        .map(result => result.layer_name);

    // Derive candidate names from BE response if FE sent empty layers
    const resolvedCandidateNames = (candidateLayerNames && candidateLayerNames.length)
        ? [...candidateLayerNames]
        : results.map(r => r.layer_name).filter(Boolean);

    return {
        status: 'ready',
        pageKey,
        documentKey,
        pageNum,
        layerMode: currentLayerField,
        candidateLayerNames: resolvedCandidateNames,
        candidateSignature,
        fireLayers,
        results,
        resultByLayer,
        cacheHitCount: Number(data?.cache_hit_count || 0),
        errorCount: Number(data?.error_count || 0),
        processingTime: Number(data?.processing_time || 0),
        updatedAt: Date.now()
    };
}

async function classifyMainLayersForCurrentPage(options = {}) {
    if (!hasRenderableDocument()) {
        throw new Error('No page data loaded.');
    }

    const documentKey = syncMainLayerClassificationDocumentCache();
    const pageNum = Number.isInteger(Number(currentPageNum)) && Number(currentPageNum) >= 1 ? Number(currentPageNum) : 1;
    const pageKey = getMainLayerPageCacheKey(pageNum);
    const candidateLayerNames = getMainLayerCandidateLayerNames();
    const candidateSignature = buildMainLayerCandidateSignature(candidateLayerNames, pageKey);
    const existingEntry = mainLayerClassificationCache.get(pageKey);

    if (!candidateLayerNames.length) {
        const emptyEntry = {
            status: 'ready',
            pageKey,
            documentKey,
            pageNum,
            layerMode: currentLayerField,
            candidateLayerNames: [],
            candidateSignature,
            fireLayers: [],
            results: [],
            resultByLayer: new Map(),
            cacheHitCount: 0,
            errorCount: 0,
            processingTime: 0,
            updatedAt: Date.now()
        };
        mainLayerClassificationCache.set(pageKey, emptyEntry);
        updateMainLayerButtonState();
        return emptyEntry;
    }

    if (!options.force && existingEntry?.status === 'ready' && existingEntry.candidateSignature === candidateSignature) {
        return existingEntry;
    }
    if (!options.force && existingEntry?.status === 'pending' && existingEntry.promise) {
        return existingEntry.promise;
    }

    const requestToken = ++mainLayerClassificationRequestToken;
    const pendingEntry = {
        status: 'pending',
        pageKey,
        documentKey,
        pageNum,
        layerMode: currentLayerField,
        candidateLayerNames: [...candidateLayerNames],
        candidateSignature,
        fireLayers: [],
        results: [],
        resultByLayer: new Map(),
        startedAt: Date.now(),
        promise: null
    };

    mainLayerClassificationCache.set(pageKey, pendingEntry);
    updateMainLayerButtonState();

    pendingEntry.promise = (async () => {
        if (!isMainLayerClassificationRequestStillCurrent(pageKey, requestToken)) {
            throw createMainLayerAbortError();
        }
        const response = await fetch(`${ENV.API_BASE_URL}/classify_main_layers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pdf_name: getCurrentMainLayerDocumentName(),
                document_key: documentKey,
                page_num: pageNum,
                layers: [],
                layer_field: currentLayerField || 'layer_1',
                force_refresh: Boolean(options.force)
            })
        });
        if (!response.ok) {
            throw new Error(await parseHttpErrorResponse(response));
        }

        const data = await response.json();
        if (!isMainLayerClassificationRequestStillCurrent(pageKey, requestToken)) {
            throw createMainLayerAbortError();
        }
        const readyEntry = normalizeMainLayerClassificationResponse(
            data,
            candidateLayerNames,
            candidateSignature,
            pageKey,
            documentKey,
            pageNum
        );
        mainLayerClassificationCache.set(pageKey, readyEntry);

        if (mainLayerClassificationRequestToken === requestToken || getMainLayerPageCacheKey() === pageKey) {
            updateLayerList();
        }
        return readyEntry;
    })().catch(error => {
        if (error?.name === 'AbortError') {
            if (mainLayerClassificationCache.get(pageKey) === pendingEntry) {
                mainLayerClassificationCache.delete(pageKey);
            }
            return {
                ...pendingEntry,
                status: 'aborted',
                error: error.message || String(error),
                promise: null,
                updatedAt: Date.now()
            };
        }
        const errorEntry = {
            ...pendingEntry,
            status: 'error',
            error: error.message || String(error),
            promise: null,
            updatedAt: Date.now()
        };
        mainLayerClassificationCache.set(pageKey, errorEntry);
        if (!options.silent && getMainLayerPageCacheKey() === pageKey) {
            alert(`Main layer classification failed: ${errorEntry.error}`);
        }
        if (getMainLayerPageCacheKey() === pageKey) {
            updateLayerList();
        }
        throw error;
    });

    return pendingEntry.promise;
}

function updateMainLayerButtonState() {
    if (!btnShowMainLayer) return;

    btnShowMainLayer.classList.remove('is-loading', 'has-result', 'has-error');

    if (!hasRenderableDocument()) {
        btnShowMainLayer.disabled = true;
        btnShowMainLayer.textContent = 'Main Layer';
        btnShowMainLayer.title = 'Không có dữ liệu page để lọc main layer';
        return;
    }

    const candidateLayerNames = getMainLayerCandidateLayerNames();
    const entry = getMainLayerEntryForCurrentPage();
    const signature = buildMainLayerCandidateSignature(candidateLayerNames, getMainLayerPageCacheKey());

    if (entry?.status === 'pending') {
        btnShowMainLayer.disabled = true;
        btnShowMainLayer.classList.add('is-loading');
        btnShowMainLayer.textContent = `Processing ${entry.candidateLayerNames?.length || candidateLayerNames.length}`;
        btnShowMainLayer.title = 'Đang gọi worker phân loại main layer...';
        return;
    }

    if (entry?.status === 'ready' && entry.candidateSignature === signature) {
        const fireCount = entry.fireLayers?.length || 0;
        btnShowMainLayer.disabled = fireCount === 0;
        btnShowMainLayer.classList.add('has-result');
        btnShowMainLayer.textContent = `Main Layer (${fireCount})`;
        btnShowMainLayer.title = fireCount > 0
            ? `Chỉ hiện ${fireCount} layer fire. DB cache hit: ${entry.cacheHitCount || 0}/${entry.results?.length || 0}`
            : `Không có layer fire trong ${entry.candidateLayerNames?.length || 0} layer ứng viên`;
        return;
    }

    if (entry?.status === 'error') {
        btnShowMainLayer.disabled = !candidateLayerNames.length;
        btnShowMainLayer.classList.add('has-error');
        btnShowMainLayer.textContent = 'Retry Main Layer';
        btnShowMainLayer.title = entry.error || 'Main layer classification failed';
        return;
    }

    btnShowMainLayer.disabled = !candidateLayerNames.length;
    btnShowMainLayer.textContent = 'Main Layer';
    btnShowMainLayer.title = candidateLayerNames.length
        ? `Phân loại ${candidateLayerNames.length} layer khác xám/trắng có hơn ${getMainLayerMinElementCount()} ele`
        : `Không có layer khác xám/trắng nào có hơn ${getMainLayerMinElementCount()} ele`;
}

function applyMainLayerClassificationFilter(entry) {
    if (entry?.status !== 'ready') {
        return;
    }
    const fireLayers = Array.isArray(entry?.fireLayers) ? entry.fireLayers : [];
    if (!fireLayers.length) {
        alert('Không có layer fire để hiển thị.');
        return;
    }

    const visibleLayerNames = new Set(fireLayers);
    Object.keys(layerVisibility).forEach(layerName => {
        layerVisibility[layerName] = visibleLayerNames.has(layerName);
    });
    mainLayers = [...fireLayers];
    applyLayerVisibilityUpdate({ refreshList: true });
}

function handleMainLayerPageLoaded() {
    syncMainLayerClassificationDocumentCache();
    updateMainLayerButtonState();
    if (CONFIG.MAIN_LAYER_CLASSIFICATION_AUTORUN === false) return;
    const candidateLayerNames = getMainLayerCandidateLayerNames();
    if (!candidateLayerNames.length) return;
    classifyMainLayersForCurrentPage({ silent: true }).catch(error => {
        console.warn('Main layer auto classification failed:', error);
    });
}

function scheduleLayerListRender() {
    pendingLayerListRenderToken += 1;
    const currentToken = pendingLayerListRenderToken;
    const render = () => {
        if (currentToken !== pendingLayerListRenderToken) return;
        updateLayerList();
    };
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(render);
        return;
    }
    setTimeout(render, 0);
}

function createLayerControl(layerName) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'layer-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = layerVisibility[layerName];
    checkbox.id = `check-${layerName}`;
    checkbox.dataset.layer = layerName;
    checkbox.addEventListener('change', e => {
        layerVisibility[e.target.dataset.layer] = e.target.checked;
        applyLayerVisibilityUpdate();
    });
    const { color, type } = getLayerVisualMeta(layerName);
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = color;
    const icon = document.createElement('div');
    icon.className = 'layer-icon';
    icon.innerHTML = icons[type] || '';
    const label = document.createElement('label');
    label.htmlFor = `check-${layerName}`;
    const displayName = layerName === '__default_shape_layer__' ? 'Shape (default)' : layerName;
    label.textContent = displayName;
    label.title = displayName;
    itemDiv.append(checkbox, swatch, icon, label);
    const confidenceBadge = createMainLayerConfidenceBadge(layerName);
    if (confidenceBadge) {
        itemDiv.appendChild(confidenceBadge);
    }
    return itemDiv;
}

function updateLayerList() {
    layerList.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const typeGroups = { shape: [], svg_graphic: [], svg_text: [], pipeline: [], detection: [] };
    const shapeLayerNames = new Set(getShapeLayerNamesForCurrentMode());
    sortedLayerKeys.forEach(layerName => {
        if (shapeLayerNames.has(layerName)) {
            typeGroups.shape.push(layerName);
        } else if (layerName.startsWith('svg_graphic')) {
            typeGroups.svg_graphic.push(layerName);
        } else if (layerName === 'svg_text') {
            typeGroups.svg_text.push(layerName);
        } else if (pipelineLayerNames.includes(layerName)) {
            typeGroups.pipeline.push(layerName);
        } else if (detectionLayerNames.includes(layerName)) {
            typeGroups.detection.push(layerName);
        }
    });
    const typeLabels = { shape: 'Shape', svg_graphic: 'Image', svg_text: 'Text', pipeline: 'Pipeline', detection: 'Detection' };
    const typeIcons = { shape: 'shape', svg_graphic: 'shape', svg_text: 'text', pipeline: 'shape', detection: 'shape' };
    Object.entries(typeGroups).forEach(([typeName, layers]) => {
        if (!layers.length) return;
        const typeNode = document.createElement('div');
        typeNode.style.marginBottom = '10px';
        const typeHeader = document.createElement('div');
        typeHeader.style.display = 'flex';
        typeHeader.style.alignItems = 'center';
        typeHeader.style.padding = '8px 10px';
        typeHeader.style.backgroundColor = '#e9ecef';
        typeHeader.style.borderRadius = '6px';
        typeHeader.style.cursor = 'pointer';
        typeHeader.style.fontWeight = 'bold';
        typeHeader.dataset.nodeId = `type-${typeName}`;
        const typeCheckbox = document.createElement('input');
        typeCheckbox.type = 'checkbox';
        const allChecked = layers.every(l => layerVisibility[l]);
        const someChecked = layers.some(l => layerVisibility[l]);
        typeCheckbox.checked = allChecked;
        typeCheckbox.indeterminate = !allChecked && someChecked;
        typeCheckbox.style.marginRight = '10px';
        typeCheckbox.addEventListener('change', e => {
            layers.forEach(l => layerVisibility[l] = e.target.checked);
            applyLayerVisibilityUpdate({ refreshList: true });
        });
        const typeIcon = document.createElement('span');
        typeIcon.className = 'layer-icon';
        typeIcon.innerHTML = icons[typeIcons[typeName]];
        const typeLabel = document.createElement('span');
        typeLabel.textContent = `${typeLabels[typeName]} (${layers.length})`;
        typeLabel.style.color = 'var(--text-color-primary)';
        const toggleIcon = document.createElement('span');
        toggleIcon.textContent = expandedNodes[`type-${typeName}`] ? UI_TEXT.TREE_EXPANDED : UI_TEXT.TREE_COLLAPSED;
        toggleIcon.style.marginLeft = 'auto';
        typeHeader.append(typeCheckbox, typeIcon, typeLabel, toggleIcon);
        typeNode.appendChild(typeHeader);
        const colorSubtree = document.createElement('div');
        colorSubtree.style.display = expandedNodes[`type-${typeName}`] ? 'block' : 'none';
        colorSubtree.style.marginLeft = '20px';

        if (typeName === 'pipeline' || typeName === 'detection') {
            layers.sort((a, b) => (totalCommands[b] || 0) - (totalCommands[a] || 0));
            layers.forEach((layerName, index) => {
                const layerItem = createLayerControl(layerName);
                layerItem.style.marginBottom = '2px';
                const label = layerItem.querySelector('label');
                label.textContent = `${layerName} (${totalCommands[layerName] || 0} ele)`;
                label.style.fontWeight = '500';
                label.title = layerName;
                colorSubtree.appendChild(layerItem);
            });
        } else if (typeName === 'shape' && currentLayerField === 'layer') {
            layers.forEach((layerName, index) => {
                const layerItem = createLayerControl(layerName);
                layerItem.style.marginBottom = '2px';
                const label = layerItem.querySelector('label');
                label.textContent = `${layerName} (${totalCommands[layerName] || 0} ele)`;
                label.style.fontWeight = '500';
                label.title = layerName;
                colorSubtree.appendChild(layerItem);
            });
        } else {
            // For layer_1 mode: group by color
            const colorGroups = {};
            layers.forEach(layerName => {
                const layerObjs = layerIndex[layerName];
                if (!layerObjs || !layerObjs.length) return;
                const firstObj = layerObjs[0];
                const color = firstObj._strokeStyle || toRgbString(firstObj.color);
                colorGroups[color] ??= [];
                colorGroups[color].push(layerName);
            });
            const sortedColorEntries = Object.entries(colorGroups).sort(([a], [b]) => a.localeCompare(b));
            sortedColorEntries.forEach(([color, colorLayers]) => {
                const colorNode = document.createElement('div');
                colorNode.className = 'layer-item';
                colorNode.style.cursor = 'pointer';
                colorNode.style.background = '#f0f8e1';
                colorNode.style.marginBottom = '2px';
                colorNode.style.border = '1px solid #dcedc8';
                colorNode.style.borderRadius = '3px';
                colorNode.style.padding = '4px';
                colorNode.dataset.nodeId = `color-${typeName}-${color}`;
                const colorCheckbox = document.createElement('input');
                colorCheckbox.type = 'checkbox';
                const allColorChecked = colorLayers.every(l => layerVisibility[l]);
                const someColorChecked = colorLayers.some(l => layerVisibility[l]);
                colorCheckbox.checked = allColorChecked;
                colorCheckbox.indeterminate = !allColorChecked && someColorChecked;
                colorCheckbox.style.marginRight = '6px';
                colorCheckbox.addEventListener('change', e => {
                    colorLayers.forEach(l => layerVisibility[l] = e.target.checked);
                    applyLayerVisibilityUpdate({ refreshList: true });
                });
                const swatch = document.createElement('div');
                swatch.className = 'color-swatch';
                swatch.style.backgroundColor = color;
                const colorLabel = document.createElement('span');
                colorLabel.textContent = `${color} (${colorLayers.length})`;
                colorLabel.style.fontSize = '13px';
                const colorToggleIcon = document.createElement('span');
                colorToggleIcon.textContent = expandedNodes[`color-${typeName}-${color}`] ? UI_TEXT.TREE_EXPANDED : UI_TEXT.TREE_COLLAPSED;
                colorToggleIcon.style.marginLeft = 'auto';
                colorNode.append(colorCheckbox, swatch, colorLabel, colorToggleIcon);
                const colorSubLayers = document.createElement('div');
                colorSubLayers.style.display = expandedNodes[`color-${typeName}-${color}`] ? 'block' : 'none';
                colorSubLayers.style.marginLeft = '16px';
                colorLayers.sort((a, b) => totalCommands[b] - totalCommands[a]);
                colorLayers.forEach((layerName, index) => {
                    const layerItem = createLayerControl(layerName);
                    layerItem.style.marginBottom = '1px';
                    const label = layerItem.querySelector('label');
                    label.textContent = `${totalCommands[layerName]} ele`;
                    label.title = layerName;
                    colorSubLayers.appendChild(layerItem);
                });
                colorNode.addEventListener('click', e => {
                    if (e.target === colorToggleIcon) {
                        const nodeId = `color-${typeName}-${color}`;
                        expandedNodes[nodeId] = !expandedNodes[nodeId];
                        updateLayerList();
                    } else if (e.target !== colorCheckbox) {
                        colorCheckbox.checked = !colorCheckbox.checked;
                        colorCheckbox.dispatchEvent(new Event('change'));
                    }
                });
                colorSubtree.appendChild(colorNode);
                colorSubtree.appendChild(colorSubLayers);
            });
        }
        typeNode.addEventListener('click', e => {
            if (e.target === toggleIcon) {
                const nodeId = `type-${typeName}`;
                expandedNodes[nodeId] = !expandedNodes[nodeId];
                updateLayerList();
            } else if (e.target !== typeCheckbox) {
                typeCheckbox.checked = !typeCheckbox.checked;
                typeCheckbox.dispatchEvent(new Event('change'));
            }
        });
        fragment.appendChild(typeNode);
        fragment.appendChild(colorSubtree);
    });
    layerList.appendChild(fragment);
    updateMainLayerButtonState();
}

if (btnShowMainLayer) {
    btnShowMainLayer.addEventListener('click', async () => {
        try {
            const entry = await classifyMainLayersForCurrentPage({ silent: false });
            applyMainLayerClassificationFilter(entry);
        } catch (error) {
            console.error('Main layer classification failed:', error);
        }
    });
}