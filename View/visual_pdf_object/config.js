// config.js
const CONFIG = {
    SIMILARITY_TOLERANCE: 0.2, // Dung sai do dai khi so sanh pattern (pixel)
    MIN_MATCHING_ITEMS_RATIO: 0.5, // Ty le lenh toi thieu de xem la khop
    SIMILARITY_THRESHOLD_GREEN: 0.6, // Nguong diem cho nhom ket qua mau xanh
    SIMILARITY_THRESHOLD_PURPLE: 0.5, // Nguong diem cho nhom ket qua mau tim
    CONFIDENCE_DISPLAY_THRESHOLD: 0.01, // Nguong confidence toi thieu de hien thi ket qua
    MAX_COMMANDS_PER_TYPE: 50, // So lenh toi da moi loai (l, c, qu) de dem mau
    MAX_ANCHOR_PATTERNS: 1, // So pattern neo toi da cho mot lan tim
    TIGHT_BBOX_PADDING_RATIO: 0.5, // Ty le padding cho bbox sat net
    CROP_HIT_TOLERANCE: 8, // Dung sai hit-test khi thao tac crop (pixel)
    TIMEOUT_MS: 5000, // Timeout cho cac tac vu tim kiem (ms)
    ZOOM_STEP: 1.2, // Buoc zoom moi lan cuon chuot
    INITIAL_ZOOM: 1.0, // Muc zoom ban dau
    ZOOM_FIT_MARGIN: 0.95, // Le de fit noi dung vao man hinh
    LOW_ZOOM_RASTER_THRESHOLD: 3, // Zoom toi da de dung raster; lon hon muc nay moi bat lai vector
    INTERACTION_DEBOUNCE_MS: 200, // Do tre debounce sau khi ket thuc pan/zoom de ve lai vector
    ZOOM_MIN: 0.1, // Zoom toi thieu
    ZOOM_MAX: 500, // Zoom toi da
    PDF_PAGE_CACHE_SCALE: 3, // Ti le render cache PDF dung chung cho VLM va low-zoom raster
    JSON_RASTER_CACHE_SCALE: 3, // Ti le raster tam cho JSON o zoom thap, gom ca shape, text va image
    SIMILAR_BBOX_LINE_WIDTH: 5, // Do day vien bbox cho ket qua tim thay
    MIN_PATTERN_LENGTH: 20, // So lenh toi thieu de bo qua kiem tra do dai
    OVERLAP_THRESHOLD: 0.2, // Nguong chong lan de gop cac bbox trung nhau
    MERGE_RESULTS: true, // Gop ket qua cua hai nhom tim kiem
    MIN_LINE_WIDTH: 0.5, // Do day toi thieu cho shape co width = 0
    MAX_SAFE_FULL_JSON_PARSE_BYTES: 25 * 1024 * 1024, // Gioi han fallback khi browser khong stream duoc JSON
    FAST_FULL_JSON_PARSE_BYTES: 100 * 1024 * 1024, // File/response JSON vua phai se uu tien JSON.parse native de nhanh hon clarinet
    JSON_PROGRESS_UPDATE_BYTES: 4 * 1024 * 1024, // Moi bao nhieu byte thi cap nhat popup loading mot lan
    JSON_STREAM_PARSE_BATCH_BYTES: 1024 * 1024, // Gom nhieu chunk text truoc khi day vao clarinet de giam overhead parser
    JSON_SESSION_CACHE_MAX_BYTES: 5 * 1024 * 1024, // Khong cache session voi JSON qua lon
    JSON_STREAM_TEXT_BUFFER_LIMIT: Number.MAX_SAFE_INTEGER, // Tang gioi han buffer de doc duoc svg lon
    PDF_UPLOAD_WS_FRAME_SIZE: 8 * 1024 * 1024,
    PDF_UPLOAD_WS_BUFFER_LIMIT: 32 * 1024 * 1024,
    PDF_THUMBNAIL_TARGET_WIDTH: 180,
    MANUAL_LABEL_SCALE: 3, // Ti le xuat label, khop voi script tao du lieu train
    MANUAL_LABEL_BBOX_PTS: 5, // Match YOLO_BBOX_PTS in training_det_sprinkler/make_data.py
    MANUAL_LABEL_SNAP_SCREEN_PX: 18,
    MANUAL_LABEL_PARALLEL_SUGGEST_TOUCH_TOLERANCE: 0.01, // Ngưỡng để 2 đầu mút được tính là chạm nhau khi gợi ý connect thẳng giữa 2 line song song
    MANUAL_LABEL_ELBOW_SUGGEST_TOUCH_TOLERANCE: 0.3, // Ngưỡng để 2 đầu mút được tính là chạm nhau khi gợi ý elbow
    MANUAL_LABEL_TEE_SUGGEST_TOUCH_TOLERANCE: 0.5, // Ngưỡng để đầu mút branch được tính là chạm vào main line khi gợi ý tee
    MANUAL_LABEL_PARALLEL_MAX_ANGLE_DEGREES: 5, // Góc lệch tối đa để vẫn coi là song song trong pair-check/gợi ý connect thẳng
    MANUAL_LABEL_MIN_SUGGEST_CONNECT_LENGTH: 8,
    MANUAL_LABEL_DASH_SEGMENT_MAX_LENGTH: 50, // Do dai toi da cua moi doan line de xem la net dut
    MANUAL_LABEL_DASH_SEGMENT_LENGTH_TOLERANCE_RATIO: 2, // Cho phep doan net dut dai hon muc chuan mot chut o elbow/tee
    MANUAL_LABEL_DASH_MAX_GAP_TO_LENGTH_RATIO: 1.5, // Gap giua 2 doan net dut toi da = do dai line dai hon * ty le nay
    MANUAL_LABEL_DASH_MAX_OFFSET: 1, // Lech vuong goc toi da khi gom net dut thang hang
    // Straight dashed-line -> one long `l` command.
    // Detection thresholds (change these first when tuning results).
    SOLIDIFY_STRAIGHT_DASH_SEGMENT_MAX_LENGTH: 50, // Base maximum length of one short dash
    SOLIDIFY_STRAIGHT_DASH_SEGMENT_LENGTH_TOLERANCE_RATIO: 2, // Effective max length = max length * this ratio
    SOLIDIFY_STRAIGHT_DASH_MAX_GAP_TO_LENGTH_RATIO: 1.5, // Pair max projected gap = longer dash * this ratio
    SOLIDIFY_STRAIGHT_DASH_MAX_LATERAL_OFFSET: 1, // Maximum perpendicular displacement between two dashes
    SOLIDIFY_STRAIGHT_DASH_MAX_ANGLE_DEGREES: 5, // Match Extract_FIRE parallel tolerance
    SOLIDIFY_STRAIGHT_DASH_MIN_SEGMENTS_PER_GROUP: 2, // Minimum short `l` commands required to create one long `l`
    SOLIDIFY_STRAIGHT_DASH_EPSILON: 1e-5, // Numeric tolerance; gaps below this are treated as touching
    SOLIDIFY_STRAIGHT_DASH_SEARCH_GAP_MULTIPLIER: 1.25, // Extra search radius; does not relax final pair validation
    SOLIDIFY_STRAIGHT_DASH_SCORE_LATERAL_WEIGHT: 4, // Penalty for lateral offset when choosing the nearest continuation
    SOLIDIFY_STRAIGHT_DASH_USE_SEQNO_GROUP_PRIORITY: true, // Prefer PDF commands linked by consecutive seqno metadata
    SOLIDIFY_STRAIGHT_DASH_MAX_FALLBACK_NEIGHBORS_PER_SIDE: 1, // Avoid destructive branching when geometry is ambiguous
    SOLIDIFY_STRAIGHT_DASH_MAX_CANDIDATES_PER_GROUP: 0, // 0 = unlimited; positive value caps one merged chain
    // Spatial-index/performance settings. Normally these do not need tuning.
    SOLIDIFY_STRAIGHT_DASH_SPATIAL_CELL_MIN_SIZE: 5,
    SOLIDIFY_STRAIGHT_DASH_SPATIAL_CELL_MAX_SIZE: 15,
    SOLIDIFY_STRAIGHT_DASH_SPATIAL_CELL_DIVISOR: 8,
    SOLIDIFY_STRAIGHT_DASH_SHAPE_YIELD_INTERVAL: 2500,
    SOLIDIFY_STRAIGHT_DASH_ENDPOINT_YIELD_INTERVAL: 3000,
    SOLIDIFY_STRAIGHT_DASH_BUTTON_MESSAGE_DURATION_MS: 1800,
    // Manual bbox: join short straight/Bezier dash fragments along an elbow.
    SOLIDIFY_ELBOW_BBOX_SEGMENT_MAX_LENGTH: 100,
    SOLIDIFY_ELBOW_BBOX_MAX_GAP_TO_LENGTH_RATIO: 2,
    SOLIDIFY_ELBOW_BBOX_MAX_BRIDGE_GAP: 100,
    SOLIDIFY_ELBOW_BBOX_ANCHOR_SEARCH_PADDING: 35,
    SOLIDIFY_ELBOW_BBOX_ANCHOR_MAX_BRIDGE_GAP: 50,
    SOLIDIFY_ELBOW_BBOX_ANCHOR_MAX_TANGENT_DEVIATION_DEGREES: 45,
    SOLIDIFY_ELBOW_BBOX_MAX_TANGENT_DEVIATION_DEGREES: 60,
    SOLIDIFY_ELBOW_BBOX_CURVE_SAMPLE_STEPS: 16,
    SOLIDIFY_ELBOW_BBOX_CURVE_MIN_TURN_DEGREES: 8,
    SOLIDIFY_ELBOW_BBOX_CURVE_SIMPLIFY_TOLERANCE: 0.08,
    SOLIDIFY_ELBOW_BBOX_BUTTON_MESSAGE_DURATION_MS: 2200,
    // Keep browser-side suggestions aligned with Extract_FIRE auto_accept on
    // ultra-dense vector pages. Below this threshold suggestions stay exact
    // and unbounded, preserving the existing behavior for normal drawings.
    EXTRACT_FIRE_AUTO_ACCEPT_LARGE_CONTEXT_LINE_CANDIDATE_THRESHOLD: 100000,
    EXTRACT_FIRE_AUTO_ACCEPT_LARGE_CONTEXT_MAX_GROUPED_LINE_CANDIDATES: 128,
    EXTRACT_FIRE_AUTO_ACCEPT_LARGE_CONTEXT_MAX_ITERATIONS: 1,
    EXTRACT_FIRE_AUTO_ACCEPT_LARGE_CONTEXT_MAX_TEE_CANDIDATES: 64,
    MANUAL_LABEL_CLASSES: Object.freeze({ junction: 0, connect: 1 }),
    MANUAL_LABEL_NUM_CROPS: 50,
    MANUAL_LABEL_CROP_SIZE: 1024,
    MANUAL_LABEL_TRAIN_RATIO: 0.9,
    MANUAL_LABEL_CROP_AREA_THRESHOLD_JUNCTION: 0.5,
    MANUAL_LABEL_MIN_BBOX_SIZE: 4,
    DETECTION_CONNECT_VERIFY_MIN_COVERAGE_RATIO: 0.4, // Ty le toi thieu cua doan connect ung vien nam trong bbox detect de duoc verify
    MAIN_LAYER_MIN_ELEMENTS: 50,
    MAIN_LAYER_BLACK_CHANNEL_MAX: 70,
    MAIN_LAYER_BLACK_BRIGHTNESS_MAX: 0.18,
    MAIN_LAYER_RENDER_SCALE: 1,
    MAIN_LAYER_CLASSIFICATION_AUTORUN: true,
};
