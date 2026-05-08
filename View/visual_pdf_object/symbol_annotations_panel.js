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
    const pageKey = getSymbolPageKey();
    const pageWasDirty = isSymbolPageDirty(pageKey);
    persistCurrentSymbolAnnotationState({ dirty: pageWasDirty });
    updateSymbolAnnotationUI();

    const hasDocumentContext = Boolean(getCurrentSymbolDocumentName());
    if (hasDocumentContext) {
        if (!options.silent) {
            setSymbolAnnotationFeedback(`Đã tạo nhãn ${label.name}. Đang lưu DB label PDF...`, 'info');
        }
        void saveSymbolAnnotationDocumentLabels({ silent: true })
            .then(result => {
                if (!options.silent) {
                    setSymbolAnnotationFeedback(`Đã tạo nhãn ${label.name}. Save DB thành công (${result?.storage_backend || 'db'}).`, 'success');
                }
            })
            .catch(error => {
                console.error('Failed to persist symbol label definition:', error);
                if (!options.silent) {
                    setSymbolAnnotationFeedback(`Đã tạo nhãn ${label.name} trên FE nhưng lưu DB label thất bại: ${error.message}`, 'error');
                }
            });
    } else if (!options.silent) {
        setSymbolAnnotationFeedback(`Đã tạo nhãn ${label.name}.`, 'success');
    }
    return label;
}

async function removeSymbolLabel(labelId, options = {}) {
    if (isSymbolAnnotationInteractionLocked()) return false;

    if (getCurrentSymbolDocumentName()) {
        try {
            await loadSymbolAnnotationDocumentSummary({ forceRefresh: true, silent: true });
        } catch (error) {
            console.warn('Failed to refresh symbol label summary before delete:', error);
        }
    }

    const label = symbolLabelDefinitions.find(candidate => candidate.id === labelId);
    if (!label) {
        return false;
    }

    const currentPageCount = symbolAnnotations.filter(annotation => annotation.labelId === label.id).length;
    if (currentPageCount > 0) {
        if (!options.skipConfirm && !window.confirm(`Xóa ${currentPageCount} bbox của nhãn ${label.name} trên page hiện tại? Nhãn sẽ vẫn được giữ lại trong PDF.`)) {
            return false;
        }

        symbolAnnotations = symbolAnnotations.filter(annotation => annotation.labelId !== label.id);
        persistCurrentSymbolAnnotationState();
        updateSymbolAnnotationUI();
        if (typeof scheduleDraw === 'function') {
            scheduleDraw();
        }

        setSymbolAnnotationFeedback(`Đã xóa ${currentPageCount} bbox của nhãn ${label.name}. Đang lưu page vào DB...`, 'info');
        try {
            const saveResult = await saveSymbolAnnotationsForCurrentPage({ silent: true });
            try {
                await loadSymbolAnnotationDocumentSummary({ forceRefresh: true, silent: true });
            } catch (refreshError) {
                console.warn('Failed to refresh symbol label summary after bbox delete:', refreshError);
            }
            updateSymbolAnnotationUI();
            setSymbolAnnotationFeedback(`Đã xóa ${currentPageCount} bbox của nhãn ${label.name}. Save DB thành công (${saveResult?.storage_backend || 'db'}).`, 'success');
            return true;
        } catch (error) {
            console.error('Failed to auto-save symbol annotations after label bbox delete:', error);
            setSymbolAnnotationFeedback(`Đã xóa bbox trên FE nhưng ghi DB thất bại: ${error.message}`, 'error');
            return false;
        }
    }

    if (!options.skipConfirm && !window.confirm(`Xóa hẳn nhãn ${label.name} khỏi toàn bộ PDF? Thao tác này sẽ xóa cả bbox của nhãn này trên mọi page đã lưu trong DB.`)) {
        return false;
    }

    symbolLabelDefinitions = symbolLabelDefinitions.filter(candidate => candidate.id !== label.id && candidate.slug !== label.slug);
    symbolAnnotationDocumentLabels = symbolAnnotationDocumentLabels.filter(candidate => candidate.id !== label.id && candidate.slug !== label.slug);

    if (selectedSymbolLabelId === label.id) {
        selectedSymbolLabelId = null;
        if (isSymbolFindArmed) {
            if (isDrawingBbox && btnDrawBbox) {
                btnDrawBbox.click();
            }
            isSymbolFindArmed = false;
        }
    }

    removeSymbolLabelFromCachedPages(label);
    if (symbolAnnotationDocumentSummary && Array.isArray(symbolAnnotationDocumentSummary.labels)) {
        symbolAnnotationDocumentSummary.labels = symbolAnnotationDocumentSummary.labels.filter(candidate => {
            const candidateSlug = candidate?.slug || candidate?.label_slug;
            return candidateSlug !== label.slug;
        });
    }
    updateSymbolAnnotationUI();
    if (typeof scheduleDraw === 'function') {
        scheduleDraw();
    }

    if (!getCurrentSymbolDocumentName()) {
        setSymbolAnnotationFeedback(`Đã xóa nhãn ${label.name}.`, 'success');
        return true;
    }

    setSymbolAnnotationFeedback(`Đã xóa nhãn ${label.name} khỏi toàn bộ PDF trên FE. Đang cập nhật DB cho mọi page...`, 'info');
    try {
        const saveResult = await saveSymbolAnnotationDocumentLabels({ silent: true });
        try {
            await loadSymbolAnnotationDocumentSummary({ forceRefresh: true, silent: true });
        } catch (refreshError) {
            console.warn('Failed to refresh symbol label summary after global label delete:', refreshError);
        }
        updateSymbolAnnotationUI();
        setSymbolAnnotationFeedback(`Đã xóa nhãn ${label.name} khỏi toàn bộ PDF và các page liên quan (${saveResult?.storage_backend || 'db'}).`, 'success');
        return true;
    } catch (error) {
        console.error('Failed to auto-save removed symbol label:', error);
        setSymbolAnnotationFeedback(`Đã xóa nhãn trên FE nhưng ghi DB thất bại: ${error.message}`, 'error');
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