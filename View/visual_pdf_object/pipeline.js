// pipeline.js

// Convert pipeline result objects to drawable shapes (inspired by Agent.html)
function convertPipelineToShapes(pipelineObjects) {
    const shapes = [];
    const pipeColorMap = {};

    // Assign colors to pipe_ids
    pipelineObjects.forEach(obj => {
        if (obj.pipe_id !== undefined && !pipeColorMap[obj.pipe_id]) {
            const colorIdx = Object.keys(pipeColorMap).length % KELLY_COLORS.length;
            const hexColor = KELLY_COLORS[colorIdx];
            // Convert hex to RGB 0-1 format
            const r = parseInt(hexColor.slice(1, 3), 16) / 255;
            const g = parseInt(hexColor.slice(3, 5), 16) / 255;
            const b = parseInt(hexColor.slice(5, 7), 16) / 255;
            pipeColorMap[obj.pipe_id] = [r, g, b];
        }
    });

    pipelineObjects.forEach((obj, idx) => {
        if (!obj.vertices || obj.vertices.length === 0) return;

        const pipeColor = pipeColorMap[obj.pipe_id] || [0.5, 0.5, 0.5];
        const shapeName = obj.shape_name || 'Unknown';
        let items = [];
        let fill = null;
        let color = pipeColor;
        let width = 3; // Increased default width

        // Use shape-specific color if defined
        if (PIPELINE_SHAPE_COLORS[shapeName]) {
            color = PIPELINE_SHAPE_COLORS[shapeName];
        }

        // Convert based on shape type (matching Agent.html visualization style)
        if (shapeName === 'Line') {
            // Line: draw as line segment or polygon based on vertices count
            if (obj.vertices.length === 2) {
                items = [['l', obj.vertices[0], obj.vertices[1]]];
            } else if (obj.vertices.length >= 4) {
                // Line as polygon (rectangle or polyline shape)
                items = [['poly', obj.vertices]];
                fill = [...pipeColor, 0.3]; // Semi-transparent fill
            } else {
                // Fallback for other cases
                items = [['poly', obj.vertices]];
                fill = [...pipeColor, 0.3];
            }
            width = 4; // Thicker lines for better visibility

        } else if (shapeName === 'Sprinkler') {
            // Sprinkler: use type-specific colors (high contrast)
            if (obj.type === 'end') {
                color = [0.0, 0.5, 1.0]; // Bright red
                fill = [...color, 0.8];
            } else if (obj.type === 'center') {
                color = [0.0, 1.0, 0.0]; // Bright green
                fill = [...color, 0.8];
            } else {
                color = [1.0, 0.0, 0.0]; // Bright blue
                fill = [...color, 0.8];
            }

            // Always draw as polygon using exact vertices
            items = [['poly', obj.vertices]];
            width = 3; // Increased width for better visibility

        } else if (shapeName === 'Tee' || shapeName === 'Elbow' ||
            shapeName === 'Cross' || shapeName === 'Reducer') {
            // Junction shapes: draw as filled circles or polygons
            if (obj.vertices.length === 1) {
                const [cx, cy] = obj.vertices[0];
                const radius = 3; // Small radius for junction points
                const points = [];
                const segments = 12; // Sufficient segments for small circle
                for (let i = 0; i < segments; i++) {
                    const angle = (i / segments) * Math.PI * 2;
                    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
                }
                items = [['poly', points]];
                fill = [...color, 0.95]; // Very high opacity for visibility
                width = 2;
            } else {
                // Multiple vertices - draw as polygon with fill
                items = [['poly', obj.vertices]];
                fill = [...color, 0.9];
                width = 3;
            }

        } else if (obj.vertices.length > 1) {
            // Generic polygon for other shape types
            items = [['poly', obj.vertices]];
            fill = [...color, 0.5];
            width = 2;
        }

        if (items.length > 0) {
            // Calculate bounding box
            const xs = obj.vertices.map(v => v[0]);
            const ys = obj.vertices.map(v => v[1]);
            const rect = [
                Math.min(...xs),
                Math.min(...ys),
                Math.max(...xs),
                Math.max(...ys)
            ];

            shapes.push({
                color: color,
                width: width,
                fill: fill,
                rect: rect,
                seqno: obj.id,
                items: items
            });
        }
    });

    return shapes;
}

// Detect pipeline on current page
async function detectPipeline() {
    let gzipData = (currentPageNum && cachedPages[currentPageNum]) ? cachedPages[currentPageNum] : null;

    if (!gzipData && currentJsonSourceFile) {
        showLoadingPopup('Preparing JSON for pipeline...', `${currentJsonSourceFile.name}${UI_TEXT.BULLET_SEPARATOR}streaming gzip cache`);
        try {
            gzipData = await ensurePipelineCacheForCurrentDocument();
        } catch (error) {
            hideLoadingPopup();
            alert(`Error preparing JSON for pipeline: ${error.message}`);
            return;
        }
    }

    if (!gzipData) {
        return;
    }

    showLoadingPopup('Detecting pipeline...', 'Sending current document to backend...');

    try {
        // Send to backend as JSON
        const startTime = performance.now();
        const response = await fetch(`${ENV.PDF_API_BASE_URL}/process_pipeline`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ gzip_data: gzipData })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        const endTime = performance.now();
        const apiTime = (endTime - startTime) / 1000;
        console.log(`Pipeline Detection API Call took ${apiTime.toFixed(3)} seconds`);
        console.log('Result received:', result);

        const pipelineObjects = Array.isArray(result) ? result : (result.json_objects || []);
        pipelineRawResults = pipelineObjects; // Store explicitly the array for export

        if (pipelineObjects.length === 0) {
            return;
        }

        // Group pipeline objects by shape_name
        const pipelineGroups = {};
        pipelineObjects.forEach(obj => {
            const shapeName = obj.shape_name || 'Unknown';
            if (!pipelineGroups[shapeName]) {
                pipelineGroups[shapeName] = [];
            }
            pipelineGroups[shapeName].push(obj);
        });

        // Convert each group to drawable shapes and add to layerIndex
        let totalPipelineShapes = 0;
        pipelineLayerNames = []; // Reset pipeline layer names
        Object.entries(pipelineGroups).forEach(([shapeName, objects]) => {
            // Use exact shape_name from backend as layer key
            const layerKey = shapeName;
            pipelineLayerNames.push(layerKey); // Track this as pipeline layer
            const shapes = convertPipelineToShapes(objects);

            console.log(`Processing ${shapeName}: ${objects.length} objects -> ${shapes.length} shapes`);

            // Create proper shape objects with layer property
            const properShapes = shapes.map((rawShape, idx) => {
                const shapeObj = {
                    id: `pipeline_${shapeName}_${idx}`,
                    layer: layerKey,
                    items: rawShape.items,
                    color: rawShape.color,
                    width: rawShape.width,
                    fill: rawShape.fill,
                    rect: rawShape.rect,
                    seqno: rawShape.seqno || 0
                };
                return prepareShapeForDraw(shapeObj, 0, true);
            });

            totalPipelineShapes += properShapes.length;
            layerIndex[layerKey] = properShapes;
            layerVisibility[layerKey] = true;

            // Calculate totalCommands for this layer
            totalCommands[layerKey] = properShapes.reduce((sum, shape) => sum + (shape.items?.length || 0), 0);

            console.log(`  -> Layer ${layerKey}: ${properShapes.length} shapes, ${totalCommands[layerKey]} commands, visibility: ${layerVisibility[layerKey]}`);

            // Add to sorted keys if not already present
            if (!sortedLayerKeys.includes(layerKey)) {
                sortedLayerKeys.push(layerKey);
            }

            // Add to allShapesSorted directly (like loadJSON does)
            properShapes.forEach(shapeObj => {
                allShapesSorted.push(shapeObj);
            });
        });

        console.log(`Total pipeline shapes added: ${totalPipelineShapes}, allShapesSorted length: ${allShapesSorted.length}`);

        sortShapesForDraw(allShapesSorted);

        // Rebuild quadtree to include new pipeline shapes
        rebuildQuadtree();
        if (typeof invalidateShapeRasterCache === 'function') {
            invalidateShapeRasterCache();
            scheduleShapeRasterCacheBuild();
        }

        // Update layer list UI
        updateLayerList();
        scheduleDraw();

        // Log success 
        console.log(`Pipeline detected successfully!`);

    } catch (error) {
        console.error('Pipeline detection error:', error);
    } finally {
        hideLoadingPopup();
    }
}