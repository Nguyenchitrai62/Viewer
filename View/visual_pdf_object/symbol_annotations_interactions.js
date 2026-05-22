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
    if (typeof window.refreshDetectionExtractUI === 'function') {
        window.refreshDetectionExtractUI();
    }
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
    if (typeof isCropModalOpen !== 'undefined' && isCropModalOpen) {
        setSymbolAnnotationFeedback('Đang mở popup Find. Hãy đóng popup hiện tại trước khi vẽ bbox mới.', 'info');
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
    if (typeof isCropModalOpen !== 'undefined' && isCropModalOpen) {
        setSymbolAnnotationFeedback('Đang mở popup Find. Hãy đóng popup hiện tại trước khi vẽ bbox xóa.', 'info');
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
            const pageKey = getSymbolPageKey();
            const pageWasDirty = isSymbolPageDirty(pageKey);
            persistCurrentSymbolAnnotationState({ dirty: pageWasDirty });
            setSymbolAnnotationFeedback(`Đã lưu pattern vector cho nhãn ${selectedLabel.name}, nhưng chưa tìm thấy bbox hợp lệ. Đang lưu DB label PDF...`, 'info');
            try {
                await saveSymbolAnnotationDocumentLabels({ silent: true });
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
        if (didAttachPattern) {
            await saveSymbolAnnotationDocumentLabels({ silent: true });
        }
        const successSuffix = didAttachPattern
            ? ' Save DB thành công và đã lưu pattern label ở cấp PDF.'
            : ' Save DB thành công.';
        setSymbolAnnotationFeedback(`Đã gắn nhãn ${selectedLabel.name} cho ${addedCount} bbox.${successSuffix}`, 'success');
    } catch (error) {
        console.error('Failed to auto-save symbol annotations:', error);
        const failurePrefix = didAttachPattern
            ? 'Đã gắn nhãn nhưng lưu DB/page hoặc pattern label thất bại'
            : 'Đã gắn nhãn nhưng tự động lưu DB thất bại';
        setSymbolAnnotationFeedback(`${failurePrefix}: ${error.message}`, 'error');
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

function getSymbolAnnotationConfidence(annotation) {
    return Number.isFinite(Number(annotation?.matchScore))
        ? Number(annotation.matchScore)
        : Number.NEGATIVE_INFINITY;
}

function isOverlappingAutoFindAnnotation(leftAnnotation, rightAnnotation) {
    const leftRect = normalizeWorldRect(leftAnnotation?.rect);
    const rightRect = normalizeWorldRect(rightAnnotation?.rect);
    if (!leftRect || !rightRect) {
        return false;
    }
    return roundRectKey(leftRect) === roundRectKey(rightRect)
        || getRectIoU(leftRect, rightRect) >= 0.92;
}

function resolveAutoFindAnnotationConflicts(annotations = []) {
    const resolvedAnnotations = [];

    annotations.forEach(annotation => {
        const existingIndex = resolvedAnnotations.findIndex(existingAnnotation => (
            isOverlappingAutoFindAnnotation(existingAnnotation, annotation)
        ));
        if (existingIndex === -1) {
            resolvedAnnotations.push(annotation);
            return;
        }

        const existingAnnotation = resolvedAnnotations[existingIndex];
        const existingConfidence = getSymbolAnnotationConfidence(existingAnnotation);
        const nextConfidence = getSymbolAnnotationConfidence(annotation);
        if (nextConfidence > existingConfidence) {
            resolvedAnnotations[existingIndex] = annotation;
            return;
        }

        if (nextConfidence === existingConfidence) {
            const existingArea = getRectArea(existingAnnotation.rect);
            const nextArea = getRectArea(annotation.rect);
            if (nextArea > 0 && (existingArea <= 0 || nextArea < existingArea)) {
                resolvedAnnotations[existingIndex] = annotation;
            }
        }
    });

    return resolvedAnnotations;
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
    const similarityThreshold = getSymbolSimilarityThresholdRatio();

    try {
        for (let index = 0; index < labelsWithPatterns.length; index += 1) {
            const label = labelsWithPatterns[index];
            setSymbolAnnotationLoading(true, `Đang tìm ${label.name} (${index + 1}/${labelsWithPatterns.length})...`);
            const searchSummary = await runSavedPatternSearch(label.vectorPattern, {
                similarityThreshold,
                showLoading: false,
                draw: false,
            });

            collectUniqueSymbolSearchEntries(searchSummary?.allResults).forEach(({ rect, result }) => {
                const resultScore = Number(result?.score);
                if (Number.isFinite(resultScore) && resultScore < similarityThreshold) {
                    return;
                }
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
        const resolvedIncomingAnnotations = resolveAutoFindAnnotationConflicts(incomingAnnotations);
        if (!resolvedIncomingAnnotations.length) {
            setSymbolAnnotationFeedback(`Đã chạy ${labelsWithPatterns.length} pattern nhưng không tìm thấy bbox mới trên page hiện tại.`, 'info');
            return;
        }

        const suppressedOverlapCount = Math.max(0, incomingAnnotations.length - resolvedIncomingAnnotations.length);
        const addedCount = mergeSymbolAnnotations(resolvedIncomingAnnotations);
        const dedupeSuffix = suppressedOverlapCount > 0
            ? `, bỏ ${suppressedOverlapCount} bbox trùng score thấp hơn`
            : '';
        setSymbolAnnotationFeedback(`Đã tìm tự động ${addedCount} bbox từ ${labelsWithPatterns.length} label${dedupeSuffix}. Đang tự động lưu DB...`, 'info');
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
    if (typeof window.shouldHideSymbolAnnotationOverlay === 'function' && window.shouldHideSymbolAnnotationOverlay()) return;
    if (typeof window.shouldSuppressSymbolAnnotationOverlay === 'function' && window.shouldSuppressSymbolAnnotationOverlay()) return;

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

    const currentDocumentName = getCurrentSymbolDocumentName();
    if (!currentDocumentName) {
        symbolAnnotations = [];
        symbolAnnotationActivePageKey = '';
        updateSymbolAnnotationUI();
        if (typeof scheduleDraw === 'function') scheduleDraw();
        return;
    }

    try {
        await loadSymbolAnnotationDocumentSummary({ silent: true });
    } catch (summaryError) {
        console.warn('Failed to load symbol annotation document summary:', summaryError);
    }

    if (!currentPageNum) {
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

async function setSymbolAnnotationPanelExpanded(expanded, options = {}) {
    const shouldExpand = Boolean(expanded);
    const nextCollapsed = !shouldExpand;
    const wasCollapsed = isSymbolAnnotationPanelCollapsed;

    applySymbolAnnotationPanelState(nextCollapsed);
    if (!shouldExpand) {
        return false;
    }
    if (!wasCollapsed && options.forceReload !== true) {
        return true;
    }

    try {
        await loadSymbolAnnotationDocumentSummary({ silent: true });
        await loadSymbolAnnotationsForCurrentPage({
            silent: true,
            keepLabels: true,
            forceRefresh: Boolean(options.forceReload)
        });
        return true;
    } catch (error) {
        console.error('Failed to load symbol annotations after expanding panel:', error);
        setSymbolAnnotationFeedback(`Tải annotation thất bại: ${error.message}`, 'error');
        return false;
    }
}

window.setSymbolAnnotationPanelExpanded = setSymbolAnnotationPanelExpanded;

if (btnToggleSymbolAnnotationPanel) {
    btnToggleSymbolAnnotationPanel.addEventListener('click', () => {
        void setSymbolAnnotationPanelExpanded(isSymbolAnnotationPanelCollapsed);
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