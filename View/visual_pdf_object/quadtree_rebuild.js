// quadtree_rebuild.js
function prepareShapeForDraw(obj, renderLayerPriority = 1, isPipelineLayer = false) {
    if (!obj) return obj;
    if (!obj.bbox) computeShapeBbox(obj);
    obj._renderLayerPriority = renderLayerPriority;
    obj._isPipelineLayer = isPipelineLayer;
    obj._sortSeqno = obj.seqno || 0;
    obj._strokeStyle = obj.color ? toRgbString(obj.color) : null;
    obj._fillStyle = obj.fill ? toRgbString(obj.fill) : null;
    obj._effectiveWidth = getEffectiveWidth(obj.width);
    return obj;
}

function sortShapesForDraw(shapes) {
    if (!Array.isArray(shapes) || shapes.length <= 1) return shapes;
    shapes.sort((a, b) => {
        const priorityDiff = (a._renderLayerPriority ?? 1) - (b._renderLayerPriority ?? 1);
        if (priorityDiff !== 0) return priorityDiff;
        return (a._sortSeqno ?? a.seqno ?? 0) - (b._sortSeqno ?? b.seqno ?? 0);
    });
    return shapes;
}

function buildLayerIndex() {
    layerIndex = {};
    totalCommands = {};
    globalSeqnoToIds = {}; // Reset global map
    seqnoToLayer = {};
    allShapesSorted = [];
    if (!jsonShapes) return;
    jsonShapes.forEach((obj, objIndex) => {
        const rawLayerName = currentLayerField === 'layer_1'
            ? (typeof obj.source_layer_1 === 'string' ? obj.source_layer_1 : obj.layer_1)
            : (typeof obj.source_layer === 'string' ? obj.source_layer : obj.layer);
        let layerName = rawLayerName;
        // If using layer_1, strictly enforce shape_color_ prefix. If using layer, allow all.
        if (currentLayerField === 'layer_1') {
            if (!layerName || !layerName.startsWith('shape_color_')) return;
        } else {
            // For 'layer' mode: use default layer name if layer field is empty/undefined
            if (!layerName || layerName.trim() === '') {
                layerName = '__default_shape_layer__';
            }
        }
        obj.layer = layerName;
        if (!obj.items || !Array.isArray(obj.items)) return;
        layerIndex[layerName] ??= [];
        prepareShapeForDraw(obj, 1, false);
        layerIndex[layerName].push(obj);
        allShapesSorted.push(obj);

        totalCommands[layerName] = (totalCommands[layerName] || 0) + obj.items.length;

        // Build globalSeqnoToIds only for black shapes
        if (obj.color && Array.isArray(obj.color) && obj.color.length >= 3 && obj.color[0] === 0 && obj.color[1] === 0 && obj.color[2] === 0) {
            const seqno = obj.seqno || 0;
            if (!globalSeqnoToIds[seqno]) globalSeqnoToIds[seqno] = [];
            obj.items.forEach((item, itemIndex) => {
                globalSeqnoToIds[seqno].push(`${objIndex}-${itemIndex}`);
            });
            seqnoToLayer[seqno] = layerName;
        }
    });

    sortShapesForDraw(allShapesSorted);

    _perLayerBounds = {};
    for (const ln in layerIndex) {
        let lMinX = Infinity, lMinY = Infinity, lMaxX = -Infinity, lMaxY = -Infinity;
        for (const obj of layerIndex[ln]) {
            if (obj.bbox) {
                lMinX = Math.min(lMinX, obj.bbox.minX);
                lMinY = Math.min(lMinY, obj.bbox.minY);
                lMaxX = Math.max(lMaxX, obj.bbox.maxX);
                lMaxY = Math.max(lMaxY, obj.bbox.maxY);
            }
        }
        if (lMinX !== Infinity) {
            _perLayerBounds[ln] = { minX: lMinX, minY: lMinY, maxX: lMaxX, maxY: lMaxY, width: Math.max(1, lMaxX - lMinX), height: Math.max(1, lMaxY - lMinY) };
        }
    }

    if (svgData) {
        layerVisibility['svg_text'] = true;
        layerVisibility['svg_graphic'] = true;
    }
    linkConsecutiveSeqnos();
    rebuildQuadtree();
    if (typeof invalidateShapeRasterCache === 'function') {
        invalidateShapeRasterCache();
        scheduleShapeRasterCacheBuild();
    }
    if (typeof rebuildSnapPointIndex === 'function') {
        rebuildSnapPointIndex();
    }
}

// ============================================
// PERFORMANCE OPTIMIZATION: Rebuild Quadtree
// ============================================
function rebuildQuadtree() {
    if (allShapesSorted.length === 0) {
        shapeQuadtree = null;
        return;
    }

    // Calculate bounds from all shapes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allShapesSorted.forEach(obj => {
        if (obj.bbox) {
            minX = Math.min(minX, obj.bbox.minX);
            minY = Math.min(minY, obj.bbox.minY);
            maxX = Math.max(maxX, obj.bbox.maxX);
            maxY = Math.max(maxY, obj.bbox.maxY);
        }
    });

    if (minX === Infinity) {
        shapeQuadtree = null;
        return;
    }

    // Add padding to bounds
    const padding = 100;
    const shapeCount = allShapesSorted.length;
    const capacity = shapeCount > 100000 ? 128 : shapeCount > 10000 ? 64 : 25;
    shapeQuadtree = new Quadtree({
        x: minX - padding,
        y: minY - padding,
        width: (maxX - minX) + padding * 2,
        height: (maxY - minY) + padding * 2
    }, capacity, 14);

    // Insert all shapes into quadtree
    allShapesSorted.forEach(obj => {
        if (obj.bbox) {
            shapeQuadtree.insert(obj);
        }
    });
    console.log(`Quadtree rebuilt with ${allShapesSorted.length} shapes`);
}