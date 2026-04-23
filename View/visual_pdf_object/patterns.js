// patterns.js

// Saved Patterns Logic
let savedPatterns = [];

function renderSavedPatternsList() {
    const container = document.getElementById('saved-patterns-list');
    if (!container) return;
    container.innerHTML = '';
    if (savedPatterns.length === 0) {
        container.innerHTML = '<div class="info-panel" style="padding: 10px; font-size: 12px;">No saved patterns</div>';
        return;
    }
    // Add grid container style - responsive wrapping
    container.style.display = 'grid';
    container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(60px, 1fr))';
    container.style.gap = '8px';
    container.style.padding = '4px';
    container.style.boxSizing = 'border-box'; // Ensure padding doesn't cause overflow
    container.style.width = '100%';
    container.style.overflowX = 'hidden'; // Force no horizontal scroll

    savedPatterns.forEach((pattern, index) => {
        const item = document.createElement('div');
        item.className = 'layer-item';
        item.style.padding = '4px';
        item.style.display = 'flex';
        item.style.flexDirection = 'column';
        item.style.alignItems = 'center';
        item.style.border = '1px solid var(--border-color-light)';
        item.style.borderRadius = '6px';
        item.style.cursor = 'pointer';
        item.style.backgroundColor = 'white';
        item.style.position = 'relative';
        item.style.transition = 'all 0.2s ease';

        // Hover effect handled by CSS via class, but adding inline for specificity
        item.onmouseenter = () => { item.style.borderColor = 'var(--accent-color)'; item.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)'; };
        item.onmouseleave = () => { item.style.borderColor = 'var(--border-color-light)'; item.style.boxShadow = 'none'; };

        item.innerHTML = `
            <div style="width: 100%; aspect-ratio: 1; overflow: hidden; border-radius: 4px; border: 1px solid #eee; background: #fafafa; display: flex; align-items: center; justify-content: center;">
                <img src="${pattern.thumbnail || ''}" style="max-width: 100%; max-height: 100%; object-fit: contain;">
            </div>
            <div class="delete-pattern" style="position: absolute; top: -6px; right: -6px; background: white; border: 1px solid #e0e0e0; color: #dc3545; border-radius: 50%; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; box-shadow: 0 1px 3px rgba(0,0,0,0.1);" title="Remove">${UI_TEXT.CLOSE_GLYPH}</div>
            <div style="font-size: 10px; color: #666; margin-top: 4px; width: 100%; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${pattern.stats || 'Pattern'}
            </div>
        `;

        // Click events
        item.onclick = (e) => {
            if (e.target.classList.contains('delete-pattern')) {
                e.stopPropagation();
                if (confirm('Delete this pattern?')) {
                    savedPatterns.splice(index, 1);
                    renderSavedPatternsList();
                }
            } else {
                applySavedPattern(pattern);
            }
        };

        container.appendChild(item);
    });
}

function saveCurrentPattern() {
    if (!cropLengths || !searchBboxSize) {
        alert('No valid pattern to save!');
        return;
    }

    // Capture thumbnail from crop canvas
    const cropCanvas = document.getElementById('crop-canvas');
    let thumbnail = '';
    if (cropCanvas) {
        // Determine crop bounds on the crop canvas to avoid saving empty whitespace
        // For simplicity, we just save the whole crop canvas which is already tightly fitted to anchorBbox in showCropModal
        thumbnail = cropCanvas.toDataURL('image/png');
    }

    // Generate stats string
    let stats = [];
    if (cropLengthsFull?.l?.length) stats.push(`${cropLengthsFull.l.length}L`);
    if (cropLengthsFull?.c?.length) stats.push(`${cropLengthsFull.c.length}C`);
    if (cropLengthsFull?.qu?.length) stats.push(`${cropLengthsFull.qu.length}Q`);
    const statsStr = stats.join(', ');

    const patternData = {
        name: `Pattern ${savedPatterns.length + 1}`, // Internal name
        thumbnail: thumbnail,
        stats: statsStr,
        timestamp: Date.now(),
        data: {
            cropLengths: JSON.parse(JSON.stringify(cropLengths)),
            cropLengthsFull: JSON.parse(JSON.stringify(cropLengthsFull)),
            cropLengthsFiltered: JSON.parse(JSON.stringify(cropLengthsFiltered)),
            anchorPatterns: JSON.parse(JSON.stringify(anchorPatterns)),
            sequencePatternTokens: JSON.parse(JSON.stringify(sequencePatternTokens)),
            searchBboxSize: JSON.parse(JSON.stringify(searchBboxSize)),
            anchorBbox: JSON.parse(JSON.stringify(anchorBbox)),
            mainLayers: mainLayers ? [...mainLayers] : []
        }
    };
    savedPatterns.push(patternData);
    renderSavedPatternsList();
    // Optional: alert('Pattern saved!');
}

function applySavedPattern(pattern) {
    if (!jsonShapes) {
        alert('No document loaded.');
        return;
    }

    // Restore pattern data
    const d = pattern.data;
    cropLengths = d.cropLengths;
    cropLengthsFull = d.cropLengthsFull;
    cropLengthsFiltered = d.cropLengthsFiltered;
    anchorPatterns = d.anchorPatterns;
    sequencePatternTokens = d.sequencePatternTokens;
    searchBboxSize = d.searchBboxSize;
    anchorBbox = d.anchorBbox;

    // Enable flag to hide blue anchor bbox
    isApplyingSavedPattern = true;

    // Logic search optimization: use saved layers if available on CURRENT page
    let validSavedLayers = [];
    if (d.mainLayers && d.mainLayers.length > 0) {
        // Only use saved layers if they actually exist on this page and are visible
        validSavedLayers = d.mainLayers.filter(layer => sortedLayerKeys.includes(layer) && layerVisibility[layer]);
    }

    if (validSavedLayers.length > 0) {
        mainLayers = validSavedLayers;
    } else {
        // Fallback: If no saved layers match the current page's shape layers, search ALL visible shape layers
        mainLayers = sortedLayerKeys.filter(key => 
            (key.startsWith('shape_') || key === '__default_shape_layer__' || currentLayerField === 'layer') && 
            !key.startsWith('svg_') && 
            !pipelineLayerNames.includes(key) && 
            layerVisibility[key]
        );
    }

    if (mainLayers.length === 0) {
        alert('No valid layers to search on (Please ensure at least one shape layer is visible).');
        return;
    }

    // Clean UI
    isDrawingBbox = false;
    btnDrawBbox.classList.remove('active');

    const popup = document.getElementById('loading-popup');
    if (popup) popup.style.display = 'flex';

    // Allow UI update then search
    setTimeout(() => {
        try {
            findSimilarRegions();
            scheduleDraw();
        } catch (err) {
            console.error('Error during saved pattern search', err);
        } finally {
            if (popup) popup.style.display = 'none';
        }
    }, 20);
}

resizeCanvas();