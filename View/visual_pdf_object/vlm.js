// vlm.js

// ============================================
// FIXED: VLM Extract Functions - Sửa lỗi preview sai
// ============================================
async function cropAndExtractVLM(bbox) {
    try {
        if (!currentPageNum || !hasRenderableDocument()) {
            showVLMModalError('Vui lòng load PDF hoac JSON truoc khi su dung VLM Extract');
            return;
        }

        // Show preview state first
        showVLMModalPreview(null, bbox);

        const targetScale = typeof getShapeRasterCacheTargetScale === 'function'
            ? getShapeRasterCacheTargetScale()
            : (CONFIG.PDF_PAGE_CACHE_SCALE || 3);
        const rasterPreview = typeof ensureShapeRasterCache === 'function'
            ? await ensureShapeRasterCache(targetScale)
            : null;

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

        // Convert to base64 JPEG chß║Ñt l╞░ß╗úng cao
        const croppedImageBase64 = cropCanvas.toDataURL('image/jpeg', 0.9);
        
        // Store for later use when user confirms
        pendingVLMCrop = croppedImageBase64;

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

function showVLMModalResult(data) {
    const loading = document.getElementById('vlm-loading');
    const result = document.getElementById('vlm-result');
    const error = document.getElementById('vlm-error');

    loading.style.display = 'none';
    error.style.display = 'none';
    result.style.display = 'block';

    // Display JSON result
    const jsonContainer = document.getElementById('vlm-json-container');
    jsonContainer.textContent = JSON.stringify(data, null, 2);
}

function showVLMModalError(message) {
    const loading = document.getElementById('vlm-loading');
    const result = document.getElementById('vlm-result');
    const error = document.getElementById('vlm-error');

    loading.style.display = 'none';
    result.style.display = 'none';
    error.style.display = 'block';

    document.getElementById('vlm-error-message').textContent = message;
}

async function callVLMExtractAPI(imageBase64, fields) {
    try {
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        
        const requestBody = {
            image_b64: base64Data,
            fields: fields
        };

        const response = await fetch(`${ENV.PDF_API_BASE_URL}/vlm_extract`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        showVLMModalResult(data);

    } catch (error) {
        console.error('VLM Extract API Error:', error);
        showVLMModalError('API Error: ' + error.message + '\n\nThe VLM Extract API endpoint is not yet available. Please ensure the backend is running.');
    }
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
    document.getElementById('vlm-modal').style.display = 'none';
});

document.getElementById('vlm-close-btn').addEventListener('click', () => {
    document.getElementById('vlm-modal').style.display = 'none';
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
    
    const preview = document.getElementById('vlm-preview');
    const loading = document.getElementById('vlm-loading');
    const result = document.getElementById('vlm-result');
    const error = document.getElementById('vlm-error');
    
    // X├│a lß╗ùi v├á kß║┐t quß║ú c┼⌐, hiß╗ân thß╗ï loading nh╞░ng giß╗» nguy├¬n (kh├┤ng ß║⌐n) preview
    error.style.display = 'none';
    result.style.display = 'none';
    loading.style.display = 'flex';
    
    try {
        await callVLMExtractAPI(pendingVLMCrop, fields);
    } catch (error) {
        showVLMModalError('Error calling VLM API: ' + error.message);
    }
});

// VLM Cancel button - close modal
document.getElementById('vlm-cancel-btn').addEventListener('click', () => {
    document.getElementById('vlm-modal').style.display = 'none';
    pendingVLMCrop = null;
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

// Close modal when clicking outside
window.addEventListener('click', (e) => {
    const modal = document.getElementById('vlm-modal');
    if (e.target === modal) {
        modal.style.display = 'none';
    }
});