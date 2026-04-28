// quadtree_rebuild.js
function prepareShapeForDraw(obj, renderLayerPriority = 1, isPipelineLayer = false) {
    if (!obj) return obj;
    if (!obj.bbox) computeShapeBbox(obj);
    obj._renderLayerPriority = renderLayerPriority;
    obj._isPipelineLayer = isPipelineLayer;
    obj._sortSeqno = obj.seqno || 0;
    obj._strokeStyle = obj.color ? toRgbString(obj.color) : null;
    obj._fillStyle = obj.fill ? toRgbString(obj.fill) : null;
    obj._effectiveWidth = getShapeVisibilityPadding(obj.width);
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
    allShapesSorted = [];
    allShapesBounds = null;
    _perLayerBounds = {};
    if (typeof invalidateSeqnoHoverIndex === 'function') {
        invalidateSeqnoHoverIndex();
    }
    if (typeof invalidateSnapPointIndex === 'function') {
        invalidateSnapPointIndex();
    }
    if (!jsonShapes) return;
    let lastSortSeqno = -Infinity;
    let isAlreadySorted = true;

    for (let objIndex = 0; objIndex < jsonShapes.length; objIndex += 1) {
        const obj = jsonShapes[objIndex];
        const rawLayerName = currentLayerField === 'layer_1'
            ? (typeof obj.source_layer_1 === 'string' ? obj.source_layer_1 : obj.layer_1)
            : (typeof obj.source_layer === 'string' ? obj.source_layer : obj.layer);
        let layerName = rawLayerName;
        // If using layer_1, strictly enforce shape_color_ prefix. If using layer, allow all.
        if (currentLayerField === 'layer_1') {
            if (!layerName || !layerName.startsWith('shape_color_')) continue;
        } else {
            // For 'layer' mode: use default layer name if layer field is empty/undefined
            if (!layerName || layerName.trim() === '') {
                layerName = '__default_shape_layer__';
            }
        }
        obj.layer = layerName;
        if (!obj.items || !Array.isArray(obj.items)) continue;
        layerIndex[layerName] ??= [];
        prepareShapeForDraw(obj, 1, false);
        layerIndex[layerName].push(obj);
        allShapesSorted.push(obj);
        const objBounds = getBoundsFromBbox(obj.bbox);
        allShapesBounds = mergeBounds(allShapesBounds, objBounds);
        _perLayerBounds[layerName] = mergeBounds(_perLayerBounds[layerName], objBounds);

        const sortSeqno = obj._sortSeqno ?? obj.seqno ?? 0;
        if (sortSeqno < lastSortSeqno) {
            isAlreadySorted = false;
        }
        lastSortSeqno = sortSeqno;

        totalCommands[layerName] = (totalCommands[layerName] || 0) + obj.items.length;
    }

    if (!isAlreadySorted) {
        sortShapesForDraw(allShapesSorted);
    }

    if (svgData) {
        layerVisibility['svg_text'] = true;
        layerVisibility['svg_graphic'] = true;
    }
    rebuildQuadtree();
    if (typeof invalidateShapeRasterCache === 'function') {
        invalidateShapeRasterCache();
        scheduleShapeRasterCacheBuild();
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

    const bounds = allShapesBounds || (() => {
        let mergedBounds = null;
        for (let index = 0; index < allShapesSorted.length; index += 1) {
            mergedBounds = mergeBounds(mergedBounds, getBoundsFromBbox(allShapesSorted[index].bbox));
        }
        return mergedBounds;
    })();

    if (!bounds) {
        shapeQuadtree = null;
        return;
    }

    // Add padding to bounds
    const padding = 100;
    const shapeCount = allShapesSorted.length;
    const capacity = shapeCount > 100000 ? 128 : shapeCount > 10000 ? 64 : 25;
    shapeQuadtree = new Quadtree({
        x: bounds.minX - padding,
        y: bounds.minY - padding,
        width: bounds.width + padding * 2,
        height: bounds.height + padding * 2
    }, capacity, 14);

    // Insert all shapes into quadtree
    allShapesSorted.forEach(obj => {
        if (obj.bbox) {
            shapeQuadtree.insert(obj);
        }
    });
    console.log(`Quadtree rebuilt with ${allShapesSorted.length} shapes`);
}
