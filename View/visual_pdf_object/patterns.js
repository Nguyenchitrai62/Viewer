// patterns.js

// Saved Patterns Logic
let savedPatterns = [];

function clonePatternValue(value) {
    if (value === undefined || value === null) return value;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        console.warn('Failed to clone pattern value:', error);
        return value;
    }
}

function buildCurrentPatternSnapshot(options = {}) {
    if (!cropLengths || !searchBboxSize) {
        return null;
    }

    const includeThumbnail = options.includeThumbnail !== false;
    const cropCanvas = document.getElementById('crop-canvas');
    let thumbnail = '';
    if (includeThumbnail && cropCanvas) {
        thumbnail = cropCanvas.toDataURL('image/png');
    }

    const stats = [];
    if (cropLengthsFull?.l?.length) stats.push(`${cropLengthsFull.l.length}L`);
    if (cropLengthsFull?.c?.length) stats.push(`${cropLengthsFull.c.length}C`);
    if (cropLengthsFull?.qu?.length) stats.push(`${cropLengthsFull.qu.length}Q`);

    return {
        name: options.name || `Pattern ${savedPatterns.length + 1}`,
        thumbnail,
        stats: stats.join(', '),
        timestamp: options.timestamp || Date.now(),
        data: {
            cropLengths: clonePatternValue(cropLengths),
            cropLengthsFull: clonePatternValue(cropLengthsFull),
            cropLengthsFiltered: clonePatternValue(cropLengthsFiltered),
            anchorPatterns: clonePatternValue(anchorPatterns),
            sequencePatternTokens: clonePatternValue(sequencePatternTokens),
            searchBboxSize: clonePatternValue(searchBboxSize),
            anchorBbox: clonePatternValue(anchorBbox),
            mainLayers: mainLayers ? [...mainLayers] : []
        }
    };
}

function restoreSavedPatternData(pattern) {
    const data = pattern?.data;
    if (!data) {
        throw new Error('Pattern không có dữ liệu vector hợp lệ.');
    }

    cropLengths = clonePatternValue(data.cropLengths);
    cropLengthsFull = clonePatternValue(data.cropLengthsFull);
    cropLengthsFiltered = clonePatternValue(data.cropLengthsFiltered);
    anchorPatterns = clonePatternValue(data.anchorPatterns) || [];
    sequencePatternTokens = clonePatternValue(data.sequencePatternTokens) || null;
    searchBboxSize = clonePatternValue(data.searchBboxSize);
    anchorBbox = clonePatternValue(data.anchorBbox);
    return data;
}

function resolveSavedPatternSearchLayers(patternData) {
    let validSavedLayers = [];
    if (patternData.mainLayers && patternData.mainLayers.length > 0) {
        validSavedLayers = patternData.mainLayers.filter(layer => sortedLayerKeys.includes(layer) && layerVisibility[layer]);
    }

    if (validSavedLayers.length > 0) {
        return validSavedLayers;
    }

    return sortedLayerKeys.filter(key =>
        (key.startsWith('shape_') || key === '__default_shape_layer__' || currentLayerField === 'layer') &&
        !key.startsWith('svg_') &&
        !pipelineLayerNames.includes(key) &&
        !detectionLayerNames.includes(key) &&
        layerVisibility[key]
    );
}

function collectSavedPatternSearchResults(pattern) {
    const similarResults = Array.isArray(similarBboxes)
        ? similarBboxes.map(rect => ({ ...rect, source: rect.source || 'similar' }))
        : [];
    const sequenceResults = Array.isArray(sequenceMatches)
        ? sequenceMatches.map(match => ({
            x: match.rect.x,
            y: match.rect.y,
            width: match.rect.width,
            height: match.rect.height,
            score: match.score,
            source: 'sequence'
        }))
        : [];

    return {
        pattern,
        similarResults,
        sequenceResults,
        allResults: [...similarResults, ...sequenceResults],
        similarityThreshold: activeSimilarityThresholdOverride?.green ?? null,
    };
}

async function runSavedPatternSearch(pattern, options = {}) {
    if (!jsonShapes) {
        throw new Error('Chưa mở document để tìm pattern.');
    }

    const patternData = restoreSavedPatternData(pattern);
    isApplyingSavedPattern = true;
    mainLayers = resolveSavedPatternSearchLayers(patternData);

    if (mainLayers.length === 0) {
        throw new Error('Không có layer hợp lệ để tìm trên page hiện tại.');
    }

    isDrawingBbox = false;
    if (btnDrawBbox) {
        btnDrawBbox.textContent = UI_TEXT.DRAW_FIND;
        btnDrawBbox.classList.remove('active');
    }
    canvasContainer?.classList.remove('drawing-bbox');

    const popup = document.getElementById('loading-popup');
    const shouldShowLoading = options.showLoading !== false;
    if (shouldShowLoading && popup) {
        popup.style.display = 'flex';
    }

    if (options.defer !== false) {
        await new Promise(resolve => setTimeout(resolve, 20));
    }

    const previousSimilarityThresholdOverride = activeSimilarityThresholdOverride;
    const requestedSimilarityThreshold = normalizeSimilarityThreshold(options.similarityThreshold, null);
    if (requestedSimilarityThreshold !== null) {
        activeSimilarityThresholdOverride = {
            green: requestedSimilarityThreshold,
            purple: requestedSimilarityThreshold,
        };
    }

    try {
        findSimilarRegions();
        if (options.draw !== false) {
            scheduleDraw();
        }
        return collectSavedPatternSearchResults(pattern);
    } finally {
        activeSimilarityThresholdOverride = previousSimilarityThresholdOverride;
        if (shouldShowLoading && popup) {
            popup.style.display = 'none';
        }
    }
}

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
    const patternData = buildCurrentPatternSnapshot();
    if (!patternData) {
        alert('No valid pattern to save!');
        return;
    }
    savedPatterns.push(patternData);
    renderSavedPatternsList();
    // Optional: alert('Pattern saved!');
}

function applySavedPattern(pattern) {
    runSavedPatternSearch(pattern, { showLoading: true, draw: true }).catch(error => {
        console.error('Error during saved pattern search', error);
        alert(error.message || 'Error during saved pattern search.');
    });
}

resizeCanvas();