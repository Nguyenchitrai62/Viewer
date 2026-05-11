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
}

function getShapeLayerNamesForCurrentMode() {
    return sortedLayerKeys.filter(layerName => {
        const isDefaultShapeLayer = layerName === '__default_shape_layer__';
        return layerName.startsWith('shape_')
            || isDefaultShapeLayer
            || (currentLayerField === 'layer' && !layerName.startsWith('svg_') && !pipelineLayerNames.includes(layerName));
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

function updateMainLayerButtonState() {
    if (!btnShowMainLayer) return;

    const mainColorGroup = getMainShapeColorGroup();
    btnShowMainLayer.disabled = !mainColorGroup;
    btnShowMainLayer.title = mainColorGroup
        ? `Chỉ hiện ${mainColorGroup.layerNames.length} layer màu ${mainColorGroup.displayColor}`
        : 'Không có shape layer để lọc';
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
    return itemDiv;
}

function updateLayerList() {
    layerList.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const typeGroups = { shape: [], svg_graphic: [], svg_text: [], pipeline: [] };
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
        }
    });
    const typeLabels = { shape: 'Shape', svg_graphic: 'Image', svg_text: 'Text', pipeline: 'Pipeline' };
    const typeIcons = { shape: 'shape', svg_graphic: 'shape', svg_text: 'text', pipeline: 'shape' };
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

        // For pipeline layers or "layer" mode shapes: show directly as flat list by name
        if (typeName === 'pipeline' || (typeName === 'shape' && currentLayerField === 'layer')) {
            layers.sort((a, b) => (totalCommands[b] || 0) - (totalCommands[a] || 0));
            layers.forEach((layerName, index) => {
                const layerItem = createLayerControl(layerName);
                layerItem.style.marginBottom = '2px';
                const label = layerItem.querySelector('label');
                label.textContent = `${layerName} (${totalCommands[layerName] || 0})`;
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
                    label.textContent = totalCommands[layerName] + ' elements';
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
    btnShowMainLayer.addEventListener('click', () => {
        const mainColorGroup = getMainShapeColorGroup();
        if (!mainColorGroup) return;
        const visibleLayerNames = new Set(mainColorGroup.layerNames);

        Object.keys(layerVisibility).forEach(layerName => {
            layerVisibility[layerName] = visibleLayerNames.has(layerName);
        });

        applyLayerVisibilityUpdate({ refreshList: true });
    });
}