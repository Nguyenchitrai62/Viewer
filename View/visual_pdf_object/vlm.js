// vlm.js

// ============================================
// FIXED: VLM Extract Functions - Sửa lỗi preview sai
// ============================================
function clearDetectedCellOverlay() {
    if (!Array.isArray(extractedCellOverlays) || extractedCellOverlays.length === 0) {
        extractedCellDownloadBundle = null;
        syncExtractedCellDownloadButton();
        return;
    }
    extractedCellOverlays = [];
    extractedCellDownloadBundle = null;
    syncExtractedCellDownloadButton();
    if (typeof scheduleCrosshairOverlayDraw === 'function') {
        scheduleCrosshairOverlayDraw();
    }
}

function hexToRgba(hexColor, alpha) {
    const normalized = String(hexColor || '').replace('#', '');
    if (normalized.length !== 6) {
        return `rgba(37, 99, 235, ${alpha})`;
    }

    const red = parseInt(normalized.slice(0, 2), 16);
    const green = parseInt(normalized.slice(2, 4), 16);
    const blue = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function decorateCellsForOverlay(cells) {
    return (Array.isArray(cells) ? cells : []).map((cell, index) => {
        const baseColor = KELLY_COLORS[index % KELLY_COLORS.length] || '#2563eb';
        return {
            ...cell,
            overlayHexColor: baseColor,
            overlayStrokeColor: hexToRgba(baseColor, 0.95),
            overlayFillColor: hexToRgba(baseColor, 0.18),
        };
    });
}

function updateVLMResultActions(options = {}) {
    const copyButton = document.getElementById('vlm-copy-btn');
    const downloadButton = document.getElementById('vlm-download-cells-btn');

    copyButton.style.display = options.showCopy === false ? 'none' : '';
    downloadButton.style.display = options.showDownloadCells ? '' : 'none';
    downloadButton.disabled = !options.showDownloadCells;
}

function syncExtractedCellDownloadButton() {
    if (!btnDownloadCellsZip) {
        return;
    }

    const cellCount = Array.isArray(extractedCellDownloadBundle?.cells)
        ? extractedCellDownloadBundle.cells.length
        : 0;

    btnDownloadCellsZip.style.display = cellCount > 0 ? '' : 'none';
    btnDownloadCellsZip.disabled = cellCount <= 0;
    btnDownloadCellsZip.textContent = cellCount > 0
        ? `🗂️ Cells ZIP (${cellCount})`
        : '🗂️ Cells ZIP';
    btnDownloadCellsZip.title = cellCount > 0
        ? `Tải ${cellCount} ảnh crop cell`
        : 'Chưa có dữ liệu cell để tải';
}

function setVLMResultContainerMode(mode) {
    const resultContainer = document.getElementById('vlm-json-container');
    if (mode === 'summary') {
        resultContainer.style.background = '#ffffff';
        resultContainer.style.border = '1px solid var(--border-color-light)';
        resultContainer.style.fontFamily = 'Segoe UI, sans-serif';
        resultContainer.style.fontSize = '14px';
        resultContainer.style.lineHeight = '1.6';
        resultContainer.style.whiteSpace = 'normal';
        resultContainer.style.wordBreak = 'break-word';
        return;
    }

    resultContainer.style.background = '#f8f9fa';
    resultContainer.style.border = '1px solid var(--border-color-light)';
    resultContainer.style.fontFamily = "'Monaco', 'Menlo', 'Ubuntu Mono', monospace";
    resultContainer.style.fontSize = '13px';
    resultContainer.style.lineHeight = '1.5';
    resultContainer.style.whiteSpace = 'pre-wrap';
    resultContainer.style.wordBreak = 'break-word';
}

function buildCellExtractSummaryHtml(summary) {
    const cellsDetected = Number(summary?.cellCount || 0);
    const processingTime = Number(summary?.processingTime || 0);
    const hasCells = cellsDetected > 0;
    const statusColor = hasCells ? '#2563eb' : '#6b7280';
    const statusText = hasCells ? 'Cells da duoc ve mau len viewer goc.' : 'Khong tim thay cell trong vung da chon.';

    return `
        <div style="display:flex; flex-direction:column; gap:14px;">
            <div style="font-size:15px; font-weight:600; color:#111827;">${escapeHtml(summary?.title || 'Ket qua trich xuat cell')}</div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:10px;">
                <div style="padding:12px; border-radius:10px; background:#eff6ff; border:1px solid #bfdbfe;">
                    <div style="font-size:12px; color:#1d4ed8; text-transform:uppercase; letter-spacing:0.04em;">So cell</div>
                    <div style="font-size:24px; font-weight:700; color:#1e3a8a;">${cellsDetected}</div>
                </div>
                <div style="padding:12px; border-radius:10px; background:#f9fafb; border:1px solid #e5e7eb;">
                    <div style="font-size:12px; color:#6b7280; text-transform:uppercase; letter-spacing:0.04em;">Xu ly</div>
                    <div style="font-size:24px; font-weight:700; color:#111827;">${processingTime.toFixed(2)}s</div>
                </div>
            </div>
            <div style="padding:12px 14px; border-radius:10px; background:${hasCells ? '#eff6ff' : '#f9fafb'}; border:1px solid ${hasCells ? '#bfdbfe' : '#e5e7eb'}; color:${statusColor};">
                <div style="font-weight:600; margin-bottom:4px;">${escapeHtml(summary?.message || statusText)}</div>
                <div style="font-size:13px; color:#4b5563;">${escapeHtml(summary?.hint || 'Neu can, bam Download Cells ZIP de lay toan bo anh crop cac cell.')}</div>
            </div>
        </div>
    `;
}

async function canvasToDataUrlAsync(canvas, mimeType = 'image/jpeg', quality = 0.9) {
    if (typeof canvas.toBlob !== 'function') {
        return canvas.toDataURL(mimeType, quality);
    }

    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(result => {
            if (result) {
                resolve(result);
                return;
            }
            reject(new Error('Khong the tao blob tu vung crop.'));
        }, mimeType, quality);
    });

    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
                return;
            }
            reject(new Error('Khong the doc du lieu crop thanh base64.'));
        };
        reader.onerror = () => reject(new Error('Khong the doc blob crop.'));
        reader.readAsDataURL(blob);
    });
}

function hideVLMModal(options = {}) {
    const modal = document.getElementById('vlm-modal');
    modal.style.display = 'none';
    activeVlmCropRequestId += 1;

    if (options.clearPending !== false) {
        pendingVLMCrop = null;
        pendingVLMBbox = null;
    }
}

function showVLMLoading(message) {
    const modal = document.getElementById('vlm-modal');
    const loading = document.getElementById('vlm-loading');
    const result = document.getElementById('vlm-result');
    const error = document.getElementById('vlm-error');

    loading.style.display = 'flex';
    result.style.display = 'none';
    error.style.display = 'none';
    updateVLMResultActions({ showCopy: true, showDownloadCells: false });
    document.getElementById('vlm-loading-text').textContent = message || 'Processing selected region';
    modal.style.display = 'block';
}

async function cropAndExtractVLM(bbox) {
    try {
        if (!currentPageNum || !hasRenderableDocument()) {
            showVLMModalError('Vui lòng load PDF hoac JSON truoc khi su dung VLM Extract');
            return;
        }

        const requestId = ++activeVlmCropRequestId;

        // Show preview state first
        showVLMModalPreview(null, bbox);
        if (typeof yieldToBrowser === 'function') {
            await yieldToBrowser();
        }

        const targetScale = typeof getShapeRasterCacheTargetScale === 'function'
            ? getShapeRasterCacheTargetScale()
            : (CONFIG.PDF_PAGE_CACHE_SCALE || 3);
        const rasterPreview = typeof ensureShapeRasterCache === 'function'
            ? await ensureShapeRasterCache(targetScale)
            : null;

        if (requestId !== activeVlmCropRequestId) {
            return;
        }

        if (!rasterPreview?.canvas || !rasterPreview?.bounds) {
            throw new Error('Khong tao duoc cache anh viewer cho VLM');
        }

        const scale = rasterPreview.scale || targetScale;
        const renderCanvas = rasterPreview.canvas;
        const sourceMinX = rasterPreview.bounds.minX || 0;
        const sourceMinY = rasterPreview.bounds.minY || 0;

        const pdfBbox = {
            x: (bbox.x - sourceMinX) * scale,
            y: (bbox.y - sourceMinY) * scale,
            width: bbox.width * scale,
            height: bbox.height * scale
        };

        // Tß║ío canvas crop
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = Math.max(1, Math.ceil(pdfBbox.width));
        cropCanvas.height = Math.max(1, Math.ceil(pdfBbox.height));
        const cropCtx = cropCanvas.getContext('2d');

        // Nß╗ün trß║»ng
        cropCtx.fillStyle = 'white';
        cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

        // Γ£à Crop ─æ├║ng vß╗ï tr├¡ tß╗½ cached page image
        cropCtx.drawImage(
            renderCanvas,
            pdfBbox.x,
            pdfBbox.y,
            pdfBbox.width,
            pdfBbox.height,
            0,
            0,
            cropCanvas.width,
            cropCanvas.height
        );

        if (typeof yieldToBrowser === 'function') {
            await yieldToBrowser();
        }

        // Convert to base64 asynchronously so the modal can paint first.
        const croppedImageBase64 = await canvasToDataUrlAsync(cropCanvas, 'image/jpeg', 0.9);

        if (requestId !== activeVlmCropRequestId) {
            return;
        }
        
        // Store for later use when user confirms
        pendingVLMCrop = croppedImageBase64;
        pendingVLMBbox = { ...bbox };
        clearDetectedCellOverlay();

        // Show preview in modal
        showVLMModalPreview(croppedImageBase64, bbox);

    } catch (error) {
        console.error('Error cropping and extracting VLM:', error);
        showVLMModalError('Error cropping image: ' + error.message);
    }
}

function showVLMModalPreview(imageBase64, bbox) {
    const modal = document.getElementById('vlm-modal');
    const preview = document.getElementById('vlm-preview');
    const loading = document.getElementById('vlm-loading');
    const result = document.getElementById('vlm-result');
    const error = document.getElementById('vlm-error');

    // Reset display states
    preview.style.display = 'block';
    loading.style.display = 'none';
    result.style.display = 'none';
    error.style.display = 'none';

    // Set preview image
    if (imageBase64) {
        document.getElementById('vlm-preview-image').src = imageBase64;
    } else {
        document.getElementById('vlm-preview-image').removeAttribute('src');
    }
    
    // Show bbox info
    if (bbox) {
        document.getElementById('vlm-preview-bbox').textContent = 
            `x: ${Math.round(bbox.x)}, y: ${Math.round(bbox.y)}, w: ${Math.round(bbox.width)}, h: ${Math.round(bbox.height)}`;
    }

    // Show modal
    modal.style.display = 'block';
}

function showVLMModal(imageBase64) {
    const modal = document.getElementById('vlm-modal');
    const loading = document.getElementById('vlm-loading');
    const result = document.getElementById('vlm-result');
    const error = document.getElementById('vlm-error');

    // Reset display states
    loading.style.display = 'flex';
    result.style.display = 'none';
    error.style.display = 'none';

    // Set cropped image
    if (imageBase64) {
        document.getElementById('vlm-cropped-image').src = imageBase64;
    }

    // Show modal
    modal.style.display = 'block';
}

function showVLMModalResult(data, options = {}) {
    const loading = document.getElementById('vlm-loading');
    const result = document.getElementById('vlm-result');
    const error = document.getElementById('vlm-error');
    const resultImageWrapper = document.getElementById('vlm-result-image-wrapper');
    const shouldShowImage = options.showImage === true;

    loading.style.display = 'none';
    error.style.display = 'none';
    result.style.display = 'block';
    resultImageWrapper.style.display = shouldShowImage ? 'block' : 'none';

    const previewImageBase64 = options.imageBase64 || pendingVLMCrop || '';
    if (shouldShowImage && previewImageBase64) {
        document.getElementById('vlm-cropped-image').src = previewImageBase64;
    } else {
        document.getElementById('vlm-cropped-image').removeAttribute('src');
    }

    updateVLMResultActions({
        showCopy: options.showCopy !== false,
        showDownloadCells: Boolean(options.showDownloadCells),
    });

    const jsonContainer = document.getElementById('vlm-json-container');
    if (options.renderMode === 'summary') {
        setVLMResultContainerMode('summary');
        jsonContainer.innerHTML = options.htmlContent || '';
    } else {
        setVLMResultContainerMode('json');
        jsonContainer.textContent = JSON.stringify(data, null, 2);
    }
}

function showVLMModalError(message) {
    const modal = document.getElementById('vlm-modal');
    const loading = document.getElementById('vlm-loading');
    const result = document.getElementById('vlm-result');
    const error = document.getElementById('vlm-error');

    loading.style.display = 'none';
    result.style.display = 'none';
    error.style.display = 'block';
    modal.style.display = 'block';

    document.getElementById('vlm-error-message').textContent = message;
}

async function callVLMExtractAPI(imageBase64, fields) {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const requestBody = {
        image_b64: base64Data,
        fields: fields
    };

    const response = await fetch(`${ENV.API_BASE_URL}/vlm_extract`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
}

async function callExtractCellsAPI(imageBase64) {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const response = await fetch(`${ENV.API_BASE_URL}/extract_cells`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            image_b64: base64Data
        })
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
}

function mapCellsToWorldCoordinates(cells, imageSize, sourceBbox) {
    const imageWidth = Number(imageSize?.width || 0);
    const imageHeight = Number(imageSize?.height || 0);
    if (!imageWidth || !imageHeight) {
        throw new Error('Kich thuoc anh crop khong hop le.');
    }

    return (Array.isArray(cells) ? cells : []).map(cell => {
        const bbox = cell?.bbox || {};
        return {
            ...cell,
            bbox: {
                x: sourceBbox.x + ((Number(bbox.x) || 0) / imageWidth) * sourceBbox.width,
                y: sourceBbox.y + ((Number(bbox.y) || 0) / imageHeight) * sourceBbox.height,
                width: ((Number(bbox.width) || 0) / imageWidth) * sourceBbox.width,
                height: ((Number(bbox.height) || 0) / imageHeight) * sourceBbox.height,
            }
        };
    }).filter(cell => cell.bbox.width > 0 && cell.bbox.height > 0);
}

function buildCellZipFileName(bundle) {
    const pageToken = currentPageNum ? `page_${String(currentPageNum).padStart(2, '0')}` : 'page';
    const bbox = bundle?.sourceBbox || {};
    const x = Math.round(Number(bbox.x) || 0);
    const y = Math.round(Number(bbox.y) || 0);
    return `${pageToken}_table_cells_${x}_${y}.zip`;
}

function createImageElementFromBase64(imageBase64) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Khong the load anh crop bang.'));
        image.src = imageBase64;
    });
}

async function buildCellCropZip(bundle) {
    if (!bundle?.sourceImageBase64 || !Array.isArray(bundle.cells) || bundle.cells.length === 0) {
        throw new Error('Khong co du lieu crop cell de tai xuong.');
    }

    const sourceImage = await createImageElementFromBase64(bundle.sourceImageBase64);
    const archive = new JSZip();

    bundle.cells.forEach((cell, index) => {
        const bbox = cell?.source_bbox || cell?.bbox || {};
        const cropWidth = Math.max(1, Math.round(Number(bbox.width) || 0));
        const cropHeight = Math.max(1, Math.round(Number(bbox.height) || 0));
        if (cropWidth <= 0 || cropHeight <= 0) {
            return;
        }

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropWidth;
        cropCanvas.height = cropHeight;
        const cropContext = cropCanvas.getContext('2d');
        cropContext.fillStyle = '#ffffff';
        cropContext.fillRect(0, 0, cropWidth, cropHeight);
        cropContext.drawImage(
            sourceImage,
            Math.round(Number(bbox.x) || 0),
            Math.round(Number(bbox.y) || 0),
            cropWidth,
            cropHeight,
            0,
            0,
            cropWidth,
            cropHeight
        );

        const baseName = cell.row > 0 && cell.column > 0
            ? `cell_r${String(cell.row).padStart(2, '0')}_c${String(cell.column).padStart(2, '0')}`
            : `cell_${String(cell.cell_id || index + 1).padStart(2, '0')}`;
        const dataUrl = cropCanvas.toDataURL('image/png');
        const base64Data = dataUrl.split(',', 2)[1];
        archive.file(`${baseName}.png`, base64Data, { base64: true });
    });

    return archive.generateAsync({ type: 'blob' });
}

async function downloadExtractedCellsZip(triggerButton = null) {
    if (!Array.isArray(extractedCellDownloadBundle?.cells) || extractedCellDownloadBundle.cells.length === 0) {
        alert('Chưa có dữ liệu cell để tải xuống.');
        syncExtractedCellDownloadButton();
        return;
    }

    const sourceButton = triggerButton || btnDownloadCellsZip;
    const originalLabel = sourceButton ? sourceButton.textContent : '';
    const fileName = buildCellZipFileName(extractedCellDownloadBundle);
    const totalCells = extractedCellDownloadBundle.cells.length;

    try {
        if (sourceButton) {
            sourceButton.disabled = true;
            sourceButton.textContent = 'Preparing ZIP...';
        }

        showLoadingPopup('Preparing Cells ZIP...', `${totalCells} cell image${totalCells === 1 ? '' : 's'}`);
        await yieldToBrowser();

        const zipBlob = await buildCellCropZip(extractedCellDownloadBundle);
        updateLoadingPopup('Starting download...', fileName);
        await yieldToBrowser();

        triggerBlobDownload(zipBlob, fileName);

        if (sourceButton) {
            sourceButton.textContent = 'Downloaded';
        }
    } catch (error) {
        console.error('Cell ZIP download error:', error);
        alert('Không thể tạo file ZIP cell: ' + error.message);
        if (sourceButton) {
            sourceButton.textContent = originalLabel;
        }
        return;
    } finally {
        hideLoadingPopup();
    }

    setTimeout(() => {
        if (sourceButton) {
            sourceButton.textContent = originalLabel;
            sourceButton.disabled = false;
        }
        syncExtractedCellDownloadButton();
    }, 1200);
}

function triggerBlobDownload(blob, fileName) {
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

let extractionTypes = [];
let editingExtTypeIndex = -1;

function loadExtractionTypes() {
    try {
        const saved = localStorage.getItem('extractionTypes');
        if (saved) extractionTypes = JSON.parse(saved);
    } catch(e) {}
    renderExtractionTypesList();
    updateVLMExtractTypeSelect();
}

function saveExtractionTypes() {
    localStorage.setItem('extractionTypes', JSON.stringify(extractionTypes));
    renderExtractionTypesList();
    updateVLMExtractTypeSelect();
}

function renderExtractionTypesList() {
    const container = document.getElementById('ext-type-list');
    if (!container) return;
    if (extractionTypes.length === 0) {
        container.innerHTML = '<div style="padding: 10px; font-size: 12px; font-style: italic; color: #999;">Chưa có loại trích xuất. Nhấn ＋ để thêm.</div>';
        return;
    }
    container.innerHTML = extractionTypes.map((t, i) => `
        <div class="ext-type-item" data-index="${i}">
            <div class="ext-type-header">
                <span class="ext-type-name">${escapeHtml(t.name)}</span>
                <div class="ext-type-actions">
                    <button class="ext-edit" data-index="${i}" title="Sửa">${UI_TEXT.EDIT_ICON}</button>
                    <button class="ext-delete" data-index="${i}" title="Xóa">${UI_TEXT.TRASH_ICON}</button>
                </div>
            </div>
            <div class="ext-type-fields">
                ${t.fields.map(f => `<span class="ext-field-tag">${escapeHtml(f.name)}</span>`).join('')}
            </div>
        </div>
    `).join('');
    container.querySelectorAll('.ext-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openExtTypeModal(parseInt(btn.dataset.index));
        });
    });
    container.querySelectorAll('.ext-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Xóa loại trích xuất này?')) {
                extractionTypes.splice(parseInt(btn.dataset.index), 1);
                saveExtractionTypes();
            }
        });
    });
}

// escapeHtml is defined in utils.js

function updateVLMExtractTypeSelect() {
    const select = document.getElementById('vlm-extract-type-select');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Chọn loại trích xuất --</option>';
    extractionTypes.forEach((t, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = t.name + ' (' + t.fields.map(f => f.name).join(', ') + ')';
        select.appendChild(opt);
    });
    if (currentVal && parseInt(currentVal) < extractionTypes.length) {
        select.value = currentVal;
    }
}

function openExtTypeModal(editIndex) {
    editingExtTypeIndex = editIndex !== undefined ? editIndex : -1;
    const overlay = document.getElementById('ext-type-modal-overlay');
    const titleEl = document.getElementById('ext-modal-title');
    const nameInput = document.getElementById('ext-type-name-input');
    const fieldList = document.getElementById('ext-field-list');

    if (editingExtTypeIndex >= 0) {
        titleEl.textContent = 'Sửa Loại Trích Xuất';
        const t = extractionTypes[editingExtTypeIndex];
        nameInput.value = t.name;
        fieldList.innerHTML = '';
        t.fields.forEach(f => addExtFieldRow(f));
    } else {
        titleEl.textContent = 'Thêm Loại Trích Xuất';
        nameInput.value = '';
        fieldList.innerHTML = '';
        addExtFieldRow();
    }
    overlay.classList.add('active');
    nameInput.focus();
}

function addExtFieldRow(fieldData) {
    const fieldList = document.getElementById('ext-field-list');
    const row = document.createElement('div');
    row.className = 'ext-field-row';
    const name = fieldData?.name || '';
    const desc = fieldData?.description || '';
    row.innerHTML = `
        <input type="text" class="ext-field-name" placeholder="Ký hiệu (VD: cd)" value="${escapeHtml(name)}" style="flex: 1;" />
        <input type="text" class="ext-field-desc" placeholder="Mô tả (VD: chiều dài tính bằng mét)" value="${escapeHtml(desc)}" style="flex: 1.5;" />
        <button title="Xóa trường" class="ext-remove-field">${UI_TEXT.CLOSE_GLYPH}</button>
    `;
    row.querySelector('.ext-remove-field').addEventListener('click', () => row.remove());
    fieldList.appendChild(row);
}

document.getElementById('btn-add-ext-type').addEventListener('click', () => openExtTypeModal());
document.getElementById('btn-ext-add-field').addEventListener('click', () => addExtFieldRow());
document.getElementById('btn-ext-cancel').addEventListener('click', () => {
    document.getElementById('ext-type-modal-overlay').classList.remove('active');
});
document.getElementById('btn-ext-save').addEventListener('click', () => {
    const name = document.getElementById('ext-type-name-input').value.trim();
    if (!name) { alert('Vui lòng nhập tên loại trích xuất'); return; }
    const fieldRows = document.querySelectorAll('#ext-field-list .ext-field-row');
    const fields = [];
    fieldRows.forEach(row => {
        const nameInp = row.querySelector('.ext-field-name');
        const descInp = row.querySelector('.ext-field-desc');
        const fieldName = nameInp.value.trim();
        const fieldDesc = descInp.value.trim();
        if (fieldName) {
            if (!fieldDesc) {
                alert(`Trường "${fieldName}" thiếu mô tả. Vui lòng nhập mô tả.`);
                nameInp.focus();
                return;
            }
            fields.push({
                name: fieldName,
                description: fieldDesc
            });
        }
    });
    if (fields.length === 0) { alert('Vui lòng thêm ít nhất 1 trường'); return; }

    if (editingExtTypeIndex >= 0) {
        extractionTypes[editingExtTypeIndex] = { name, fields };
    } else {
        extractionTypes.push({ name, fields });
    }
    saveExtractionTypes();
    document.getElementById('ext-type-modal-overlay').classList.remove('active');
});
document.getElementById('ext-type-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('active');
});

document.getElementById('vlm-extract-type-select').addEventListener('change', (e) => {
    const idx = e.target.value;
    const previewContainer = document.getElementById('vlm-fields-preview-container');
    const previewDiv = document.getElementById('vlm-fields-preview');
    
    // Tß╗▒ ─æß╗Öng ß║⌐n lß╗ùi khi user thay ─æß╗òi (chß╗ìn lß║íi) loß║íi tr├¡ch xuß║Ñt
    document.getElementById('vlm-error').style.display = 'none';
    
    if (idx !== '' && extractionTypes[parseInt(idx)]) {
        const t = extractionTypes[parseInt(idx)];
        previewDiv.innerHTML = t.fields.map(f => `<span class="ext-field-tag">${escapeHtml(f.name)}</span>`).join('');
        previewContainer.style.display = 'block';
    } else {
        previewContainer.style.display = 'none';
    }
});

loadExtractionTypes();

// VLM Modal Event Listeners
// VLM Modal Event Listeners
document.getElementById('vlm-modal-close').addEventListener('click', () => {
    hideVLMModal();
});

document.getElementById('vlm-close-btn').addEventListener('click', () => {
    hideVLMModal();
});

// VLM Confirm button - send to API
document.getElementById('vlm-confirm-btn').addEventListener('click', async () => {
    if (!pendingVLMCrop) {
        showVLMModalError('No image to process');
        return;
    }

    const selectEl = document.getElementById('vlm-extract-type-select');
    const selectedIdx = selectEl.value;
    let fields = null;
    if (selectedIdx !== '' && extractionTypes[parseInt(selectedIdx)]) {
        fields = extractionTypes[parseInt(selectedIdx)].fields;
    }
    if (!fields || fields.length === 0) {
        showVLMModalError('Vui lòng chọn loại trích xuất trước khi gửi.');
        return;
    }
    
    showVLMLoading('Analyzing with VLM...');
    
    try {
        const data = await callVLMExtractAPI(pendingVLMCrop, fields);
        showVLMModalResult(data, {
            showImage: false,
        });
    } catch (error) {
        console.error('VLM Extract API Error:', error);
        showVLMModalError('API Error: ' + error.message + '\n\nThe VLM Extract API endpoint is not yet available. Please ensure the backend is running.');
    }
});

document.getElementById('vlm-detect-cells-btn').addEventListener('click', async () => {
    if (!pendingVLMCrop || !pendingVLMBbox) {
        showVLMModalError('No table crop is available for cell extraction.');
        return;
    }

    const sourceBbox = { ...pendingVLMBbox };
    showVLMLoading('Detecting table cells...');

    try {
        const data = await callExtractCellsAPI(pendingVLMCrop);
        if (data?.error) {
            showVLMModalError(data.error);
            return;
        }

        const decoratedSourceCells = decorateCellsForOverlay(Array.isArray(data?.cells) ? data.cells.map(cell => ({
            ...cell,
            source_bbox: cell?.bbox ? { ...cell.bbox } : null,
        })) : []);
        const worldCells = decorateCellsForOverlay(mapCellsToWorldCoordinates(decoratedSourceCells, data?.image_size, sourceBbox));
        if (!worldCells.length) {
            extractedCellOverlays = [];
            extractedCellDownloadBundle = null;
            syncExtractedCellDownloadButton();
            showVLMModalResult({
                message: 'Khong phat hien cell nao trong vung da chon.',
                cell_count: 0,
                processing_time: data?.processing_time || null,
            }, {
                imageBase64: pendingVLMCrop,
                showCopy: false,
                showDownloadCells: false,
                showImage: false,
                renderMode: 'summary',
                htmlContent: buildCellExtractSummaryHtml({
                    title: 'Khong co cell duoc phat hien',
                    cellCount: 0,
                    processingTime: data?.processing_time || 0,
                    message: 'Khong phat hien cell nao trong vung table da chon.',
                    hint: 'Thu ve bbox chat hon hoac chon lai vung bang roi trich xuat lai.',
                }),
            });
            return;
        }

        extractedCellOverlays = worldCells;
        extractedCellDownloadBundle = {
            sourceImageBase64: pendingVLMCrop,
            sourceBbox: sourceBbox,
            imageSize: data?.image_size || null,
            cells: decoratedSourceCells,
        };
        syncExtractedCellDownloadButton();
        if (typeof scheduleCrosshairOverlayDraw === 'function') {
            scheduleCrosshairOverlayDraw();
        }
        if (typeof scheduleDraw === 'function') {
            scheduleDraw();
        }
        showVLMModalResult({
            mode: 'extract_cells',
            message: 'Da trich xuat cell va ve overlay len viewer. Dong popup de xem tren ban goc.',
            cell_count: worldCells.length,
            processing_time: data?.processing_time || null,
        }, {
            imageBase64: pendingVLMCrop,
            showCopy: false,
            showDownloadCells: false,
            showImage: false,
            renderMode: 'summary',
            htmlContent: buildCellExtractSummaryHtml({
                title: 'Da trich xuat cell thanh cong',
                cellCount: worldCells.length,
                processingTime: data?.processing_time || 0,
                message: 'Tat ca cell da duoc to mau va ve len viewer goc.',
                hint: 'Kiem tra overlay tren ban ve xong, bam nut Cells ZIP ngoai toolbar de tai anh crop tung cell.',
            }),
        });
    } catch (error) {
        console.error('Cell Extract API Error:', error);
        showVLMModalError('API Error: ' + error.message + '\n\nPlease ensure the extract_cells backend endpoint is running.');
    }
});

// VLM Cancel button - close modal
document.getElementById('vlm-cancel-btn').addEventListener('click', () => {
    hideVLMModal();
});

document.getElementById('vlm-copy-btn').addEventListener('click', () => {
    const jsonText = document.getElementById('vlm-json-container').textContent;
    navigator.clipboard.writeText(jsonText).then(() => {
        const btn = document.getElementById('vlm-copy-btn');
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.backgroundColor = '#28a745';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.backgroundColor = '';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy to clipboard');
    });
});

document.getElementById('vlm-download-cells-btn').addEventListener('click', async () => {
    await downloadExtractedCellsZip(document.getElementById('vlm-download-cells-btn'));
});

if (btnDownloadCellsZip) {
    btnDownloadCellsZip.addEventListener('click', async () => {
        await downloadExtractedCellsZip(btnDownloadCellsZip);
    });
}

syncExtractedCellDownloadButton();

// Close modal when clicking outside
window.addEventListener('click', (e) => {
    const modal = document.getElementById('vlm-modal');
    if (e.target === modal) {
        hideVLMModal();
    }
});