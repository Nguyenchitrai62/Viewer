// layer_controls.js
// Layer Controls (giữ nguyên)
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
        // Reset interaction state so SVG layers respond immediately
        isInteracting = false;
        if (interactionTimer) { clearTimeout(interactionTimer); interactionTimer = null; }
        if (typeof invalidateShapeRasterCache === 'function') {
            invalidateShapeRasterCache();
            scheduleShapeRasterCacheBuild();
        }
        scheduleDraw();
        // Directly update SVG layer visibility (avoid waiting for debounce)
        applySvgTransform();
    });
    let color, type;
    if (layerName === 'svg_text') {
        color = '#444';
        type = 'text';
    } else if (layerName === 'svg_graphic') {
        color = '#222';
        type = 'shape';
    } else {
        const layerObjs = layerIndex[layerName];
        if (!layerObjs || !layerObjs.length) {
            color = '#888';
            type = 'shape';
        } else {
            const firstObj = layerObjs[0];
            color = toRgbString(firstObj.color);
            type = firstObj.fill ? 'filled' : 'shape';
        }
    }
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
    const typeGroups = { shape: [], svg_graphic: [], svg_text: [], pipeline: [] };
    sortedLayerKeys.forEach(layerName => {
        const isDefaultShapeLayer = layerName === '__default_shape_layer__';
        if (layerName.startsWith('shape_') || isDefaultShapeLayer || (currentLayerField === 'layer' && !layerName.startsWith('svg_') && !pipelineLayerNames.includes(layerName))) {
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
            isInteracting = false;
            if (interactionTimer) { clearTimeout(interactionTimer); interactionTimer = null; }
            if (typeof invalidateShapeRasterCache === 'function') {
                invalidateShapeRasterCache();
                scheduleShapeRasterCacheBuild();
            }
            updateLayerList();
            scheduleDraw();
            applySvgTransform();
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
                const color = toRgbString(firstObj.color);
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
                    isInteracting = false;
                    if (interactionTimer) { clearTimeout(interactionTimer); interactionTimer = null; }
                    if (typeof invalidateShapeRasterCache === 'function') {
                        invalidateShapeRasterCache();
                        scheduleShapeRasterCacheBuild();
                    }
                    updateLayerList();
                    scheduleDraw();
                    applySvgTransform();
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
        layerList.appendChild(typeNode);
        layerList.appendChild(colorSubtree);
    });
}