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
    PDF_UPLOAD_CHUNK_SIZE: 80 * 1024 * 1024,
    PDF_UPLOAD_CHUNK_THRESHOLD: 80 * 1024 * 1024,
    MANUAL_LABEL_SCALE: 3, // Ti le xuat label, khop voi script tao du lieu train
    MANUAL_LABEL_BBOX_PTS: 5, // Match YOLO_BBOX_PTS in training_det_sprinkler/make_data.py
    MANUAL_LABEL_SNAP_SCREEN_PX: 18,
    MANUAL_LABEL_CLASSES: Object.freeze({ junction: 0, connect: 1 }),
    MANUAL_LABEL_NUM_CROPS: 50,
    MANUAL_LABEL_CROP_SIZE: 1024,
    MANUAL_LABEL_TRAIN_RATIO: 0.9,
    MANUAL_LABEL_CROP_AREA_THRESHOLD_JUNCTION: 0.5,
    MANUAL_LABEL_MIN_BBOX_SIZE: 4,
};
