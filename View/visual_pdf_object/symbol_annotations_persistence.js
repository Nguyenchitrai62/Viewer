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

function buildSymbolAnnotationDocumentPayload() {
    const pdfName = getCurrentSymbolDocumentName();
    if (!pdfName) {
        return null;
    }

    const labels = mergeSymbolLabelDefinitionLists(symbolAnnotationDocumentLabels);

    return {
        pdf_name: pdfName,
        labels: labels.map(serializeSymbolLabelDefinition)
    };
}

function cloneSymbolAnnotationPayload(payload) {
    if (!payload) return null;
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(payload);
        } catch (error) {
            console.warn('Failed to structuredClone symbol annotation payload, falling back to JSON clone:', error);
        }
    }
    try {
        return JSON.parse(JSON.stringify(payload));
    } catch (error) {
        console.warn('Failed to clone symbol annotation payload:', error);
        return null;
    }
}

function getSymbolAnnotationPageCacheEntry(pageKey, { touch = true } = {}) {
    if (!pageKey || !symbolAnnotationPageCache.has(pageKey)) {
        return null;
    }

    const entry = symbolAnnotationPageCache.get(pageKey);
    if (!entry?.payload) {
        symbolAnnotationPageCache.delete(pageKey);
        return null;
    }

    if (touch) {
        symbolAnnotationPageCache.delete(pageKey);
        symbolAnnotationPageCache.set(pageKey, entry);
    }

    return entry;
}

function evictSymbolAnnotationPageCacheEntries(retainPageKey = '') {
    while (SYMBOL_ANNOTATION_PAGE_CACHE_LIMIT > 0 && symbolAnnotationPageCache.size > SYMBOL_ANNOTATION_PAGE_CACHE_LIMIT) {
        let evictedEntry = null;

        for (const [candidatePageKey] of symbolAnnotationPageCache.entries()) {
            if (candidatePageKey === retainPageKey && symbolAnnotationPageCache.size > 1) {
                continue;
            }
            if (isSymbolPageDirty(candidatePageKey)) {
                continue;
            }

            evictedEntry = candidatePageKey;
            break;
        }

        if (!evictedEntry) {
            break;
        }

        symbolAnnotationPageCache.delete(evictedEntry);
    }
}

function storeSymbolAnnotationPageCacheEntry(pageKey, payload, { clonePayload = true } = {}) {
    const normalizedPayload = clonePayload ? cloneSymbolAnnotationPayload(payload) : payload;
    if (!pageKey || !normalizedPayload) {
        return null;
    }

    if (symbolAnnotationPageCache.has(pageKey)) {
        symbolAnnotationPageCache.delete(pageKey);
    }

    const nextEntry = { payload: normalizedPayload };
    symbolAnnotationPageCache.set(pageKey, nextEntry);
    evictSymbolAnnotationPageCacheEntries(pageKey);
    return normalizedPayload;
}

function cacheSymbolAnnotationDocumentSummaryPayload(payload, options = {}) {
    const pdfName = normalizeSymbolDocumentName(payload?.pdf_name || getCurrentSymbolDocumentName());
    if (!pdfName) {
        return null;
    }

    replaceSymbolAnnotationDocumentLabels(payload?.labels || []);
    const pages = Array.isArray(payload?.pages)
        ? (cloneSymbolAnnotationPayload(payload.pages) || [])
        : (cloneSymbolAnnotationPayload(symbolAnnotationDocumentSummary?.pages || []) || []);

    symbolAnnotationDocumentSummary = {
        pdf_name: pdfName,
        labels: cloneSymbolAnnotationPayload(symbolAnnotationDocumentLabels) || [],
        pages,
        storage_backend: payload?.storage_backend || symbolAnnotationDocumentSummary?.storage_backend || 'db'
    };

    const documentKey = options.documentKey || getCurrentSymbolDocumentCacheKey();
    if (documentKey) {
        symbolAnnotationDocumentSummaryKey = documentKey;
    }
    return cloneSymbolAnnotationPayload(symbolAnnotationDocumentSummary);
}

function cacheSymbolAnnotationPagePayload(pageKey, payload, options = {}) {
    const storedPayload = storeSymbolAnnotationPageCacheEntry(pageKey, payload, {
        clonePayload: options.clonePayload !== false
    });
    if (!pageKey || !storedPayload) {
        return null;
    }

    if (Array.isArray(storedPayload.labels) && storedPayload.labels.length) {
        setSymbolAnnotationDocumentLabels(storedPayload.labels);
    }

    const annotationCount = Array.isArray(storedPayload.annotations) ? storedPayload.annotations.length : 0;
    if (annotationCount > 0) {
        symbolAnnotationKnownEmptyPageKeys.delete(pageKey);
    } else {
        symbolAnnotationKnownEmptyPageKeys.add(pageKey);
    }

    if (options.returnClone === false) {
        return storedPayload;
    }
    return cloneSymbolAnnotationPayload(storedPayload);
}

function getCachedSymbolAnnotationPagePayload(pageKey) {
    const cachedEntry = getSymbolAnnotationPageCacheEntry(pageKey);
    if (!cachedEntry) {
        if (pageKey && symbolAnnotationKnownEmptyPageKeys.has(pageKey)) {
            const parsedKey = parseSymbolPageKey(pageKey);
            if (parsedKey) {
                return buildEmptySymbolAnnotationClientPayload(parsedKey.pdfName, parsedKey.pageNum);
            }
        }
        return null;
    }

    return cloneSymbolAnnotationPayload(cachedEntry.payload);
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
    cacheSymbolAnnotationPagePayload(pageKey, payload, { clonePayload: false, returnClone: false });
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

async function saveSymbolAnnotationDocumentLabels(options = {}) {
    syncSymbolAnnotationCacheDocument();

    const payload = buildSymbolAnnotationDocumentPayload();
    if (!payload) {
        if (!options.silent) {
            setSymbolAnnotationFeedback('Chưa đủ ngữ cảnh PDF để lưu danh sách label.', 'error');
        }
        return null;
    }

    if (symbolAnnotationPendingDocumentSave) {
        symbolAnnotationQueuedDocumentSave = true;
        return symbolAnnotationPendingDocumentSave;
    }

    const requestDocumentKey = getCurrentSymbolDocumentCacheKey();
    const requestPdfName = payload.pdf_name;
    const savePromise = (async () => {
        const response = await fetch(`${ENV.API_BASE_URL}/annotations/symbols/document`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw new Error(await parseSymbolAnnotationErrorResponse(response));
        }

        const data = await response.json();
        const activeDocumentKey = getCurrentSymbolDocumentCacheKey();
        const activePdfName = getCurrentSymbolDocumentName();
        if (!requestDocumentKey || (requestDocumentKey === activeDocumentKey && requestPdfName === activePdfName)) {
            cacheSymbolAnnotationDocumentSummaryPayload({
                pdf_name: data?.pdf_name || payload.pdf_name,
                labels: Array.isArray(data?.labels) ? data.labels : payload.labels,
                storage_backend: data?.storage_backend || 'db'
            }, {
                documentKey: requestDocumentKey
            });
        }
        return data;
    })();

    symbolAnnotationPendingDocumentSave = savePromise;
    try {
        return await savePromise;
    } finally {
        if (symbolAnnotationPendingDocumentSave === savePromise) {
            symbolAnnotationPendingDocumentSave = null;
        }
        if (symbolAnnotationQueuedDocumentSave) {
            symbolAnnotationQueuedDocumentSave = false;
            void saveSymbolAnnotationDocumentLabels({ silent: true }).catch(error => {
                console.error('Failed to flush queued symbol document-label save:', error);
            });
        }
    }
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
            if (documentKey && documentKey !== getCurrentSymbolDocumentCacheKey()) {
                return cloneSymbolAnnotationPayload(data);
            }
            return cacheSymbolAnnotationDocumentSummaryPayload(data, { documentKey });
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
            const payload = cacheSymbolAnnotationPagePayload(pageKey, data, { clonePayload: false, returnClone: false }) || data;
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
        }, { clonePayload: false, returnClone: false });
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
    getPageGzipCacheKeys(cachedPages).forEach(pageNum => pageNumbers.add(Number(pageNum)));
    getPageGzipCacheKeys(stagedCachedPages).forEach(pageNum => pageNumbers.add(Number(pageNum)));
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
                cacheSymbolAnnotationPagePayload(pageKey, payload, { clonePayload: false, returnClone: false });
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
        cacheSymbolAnnotationPagePayload(pageKey, payload, { clonePayload: false, returnClone: false });
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

    if (!symbolAnnotationDocumentSummary || symbolAnnotationDocumentSummaryKey !== getCurrentSymbolDocumentCacheKey() || options.forceRefreshDocument) {
        try {
            await loadSymbolAnnotationDocumentSummary({
                silent: true,
                forceRefresh: Boolean(options.forceRefreshDocument)
            });
        } catch (error) {
            console.warn('Failed to load symbol label summary before page annotations:', error);
        }
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