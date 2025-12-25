(function () {
    const canvas = document.getElementById('messageCanvas');
    const ctx = canvas.getContext('2d');
    
    // UI Elements (New IDs)
    const arrowPrev = document.getElementById('arrowPrev');
    const arrowNext = document.getElementById('arrowNext');
    const lblPage = document.getElementById('pageIndicator');

    // --- State ---
    let atlasMap = null;
    let atlasImages = [];
    let textboxImage = null;
    let metrics = { " ": 8.671875 }; 
    let assetsLoaded = false;
    let currentPages = [""];
    let pageIndex = 0;

    // --- Constants ---
    const BASE_FONT_SIZE = 64.0;
    const GAME_BASE_SIZE = 54.0;
    const SIZE_SCALE = BASE_FONT_SIZE / GAME_BASE_SIZE; 

    const MAX_WIDTH = 1080.0;
    const CALIBRATION_PHRASE = "Oh. And it needs to be found and caught down";
    const MAX_LINES_PER_PAGE = 2;

    const TEXT_OFFSET_X = 100; 
    const TEXT_OFFSET_Y = 45; 
    const LINE_HEIGHT_INC = 12; 

    const CANVAS_WIDTH = 1500;
    const CANVAS_HEIGHT = 230;

    let pixelsPerUnit = 1.8848; 
    let baseMetric = 573.0; 

    // --- Init ---
    async function init() {
        try {
            await loadMetrics();

            const mapResp = await fetch(window.atlasMapUri);
            if (!mapResp.ok) throw new Error("Atlas Map 404");
            const mapData = await mapResp.json();
            atlasMap = mapData.glyphs || mapData;
            atlasMap.size = mapData.size || 100; 

            textboxImage = new Image();
            textboxImage.src = window.textboxUri;
            await new Promise(r => { textboxImage.onload = r; textboxImage.onerror = r; });

            const promises = [];
            for (let i = 0; i < 8; i++) {
                const img = new Image();
                img.src = `${window.fontBaseUri}/atlas_${i}.png`;
                promises.push(new Promise(r => { img.onload = () => { atlasImages[i] = img; r(); }; img.onerror = r; }));
            }
            await Promise.all(promises);

            calibrateMetrics();
            assetsLoaded = true;
            
            canvas.width = CANVAS_WIDTH;
            canvas.height = CANVAS_HEIGHT;

            draw();

        } catch (e) {
            console.error(e);
        }
    }

    async function loadMetrics() {
        try {
            const resp = await fetch(window.metricsUri);
            if (!resp.ok) return;
            const text = await resp.text();
            const lines = text.split(/\r?\n/);
            lines.forEach(line => {
                if (!line || line.startsWith("//")) return;
                
                let char = null;
                let width = 0.0;

                if (line.includes(",")) {
                    if (line.startsWith(",")) {
                        const parts = line.split(",");
                        if (parts.length >= 2) {
                            char = ",";
                            width = parseFloat(parts[1]);
                        }
                    } else {
                        const parts = line.split(",");
                        if (parts.length >= 2) {
                            char = parts[0];
                            width = parseFloat(parts[1]);
                        }
                    }
                } 
                else if (line.trim().length > 0) {
                    if (line.startsWith(" ") && !isNaN(parseFloat(line.trim()))) {
                        char = " ";
                        width = parseFloat(line.trim());
                    } else {
                        const parts = line.split(/[ \t]+/).filter(s => s.length > 0);
                        if (parts.length >= 2) {
                            char = parts[0];
                            width = parseFloat(parts[parts.length - 1]);
                        }
                    }
                }

                if (char !== null && !isNaN(width)) {
                    metrics[char] = width;
                }
            });
            if (!metrics[" "]) metrics[" "] = 8.671875;
        } catch (e) {}
    }

    function calibrateMetrics() {
        const measured = measureText(CALIBRATION_PHRASE);
        if (measured > 0) {
            baseMetric = measured;
            pixelsPerUnit = MAX_WIDTH / measured;
        }
    }

    // --- UI Handlers ---
    
    // Attach to arrows instead of buttons
    arrowPrev.onclick = () => { 
        if (pageIndex > 0) { 
            pageIndex--; 
            draw(); 
        } 
    };
    
    arrowNext.onclick = () => { 
        if (pageIndex < currentPages.length - 1) { 
            pageIndex++; 
            draw(); 
        } 
    };

    window.addEventListener('message', e => {
        if (e.data.type === 'updateText') {
            const rawText = e.data.text;
            currentPages = splitIntoPages(rawText);
            pageIndex = 0;
            if (assetsLoaded) draw();
        }
    });

    // --- Logic ---

    function splitIntoPages(rawText) {
        let text = rawText
            .replace(/\\n/g, '{n}')
            .replace(/\\r/g, '{r}')
            .replace(/\\f/g, '{f}');

        const tokens = text.split(/(\{n\}|\{f\}|\{r\})/g);
        const pages = [];
        let currentPage = [];
        let lastLine = null;

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (!token) continue;

            if (token === '{n}') { /* No-op */ } 
            else if (token === '{r}') {
                if (currentPage.length > 0) { pages.push(currentPage.join('\n')); currentPage = []; }
                lastLine = null;
            } 
            else if (token === '{f}') {
                if (currentPage.length > 0) { pages.push(currentPage.join('\n')); currentPage = []; }
                if (lastLine !== null) currentPage.push(lastLine);
                
                if (i + 1 < tokens.length) {
                    const next = tokens[i + 1];
                    if (next !== '{n}' && next !== '{f}' && next !== '{r}') {
                        currentPage.push(next);
                        lastLine = next;
                        i++;
                    }
                }
            } 
            else {
                currentPage.push(token);
                lastLine = token;
                if (currentPage.length >= MAX_LINES_PER_PAGE) {
                    pages.push(currentPage.join('\n'));
                    currentPage = [];
                }
            }
        }
        if (currentPage.length > 0) pages.push(currentPage.join('\n'));
        return pages.length > 0 ? pages : [""];
    }

    function measureText(text) {
        let width = 0.0;
        for (let i = 0; i < text.length; i++) {
            if (i + 2 < text.length && text.substring(i, i + 3) === "{n}") { 
                width += 343.6875; 
                i += 2; 
                continue; 
            }
            
            let char = text[i];
            if (char === "'") char = "’";

            if (metrics[char] !== undefined) width += metrics[char];
            else if (!isNaN(parseInt(char))) width += 15.0; 
            else width += 8.671875;
        }
        return width;
    }

    function calculateAdvance(char, lineScale) {
        let charStr = char === "'" ? "’" : char;
        let w = 8.671875;
        
        if (metrics[charStr] !== undefined) w = metrics[charStr];
        else if (!isNaN(parseInt(char))) w = 15.0;

        return w * pixelsPerUnit * lineScale * SIZE_SCALE;
    }

    function draw() {
        // Update Overlays
        // Page format: "1/2"
        lblPage.innerText = `${pageIndex + 1}/${currentPages.length}`;
        
        // Arrow Visibility Logic
        arrowPrev.style.display = (pageIndex > 0) ? 'block' : 'none';
        arrowNext.style.display = (pageIndex < currentPages.length - 1) ? 'block' : 'none';

        // Reset Canvas
        canvas.width = CANVAS_WIDTH;
        canvas.height = CANVAS_HEIGHT;

        ctx.fillStyle = "#202020";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        if (textboxImage && textboxImage.complete && textboxImage.naturalWidth > 0) {
             ctx.drawImage(textboxImage, 0, 0, canvas.width, canvas.height);
        }

        if (!atlasMap) return;

        const pageText = currentPages[pageIndex] || "";
        const lines = pageText.split('\n');
        
        let currentY = TEXT_OFFSET_Y;
        const refSize = atlasMap.size || 100;

        lines.forEach(line => {
            if (!line) return;

            const lineWidth = measureText(line);
            let lineScale = 1.0;
            
            if (lineWidth > baseMetric) {
                lineScale = baseMetric / lineWidth;
            }

            const targetFontSize = BASE_FONT_SIZE * lineScale;
            const renderScale = targetFontSize / refSize;

            let cursorX = TEXT_OFFSET_X;

            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const advance = calculateAdvance(char, lineScale);

                if (char === ' ') {
                    cursorX += advance;
                    continue;
                }

                const code = char.charCodeAt(0);
                const hex = code.toString(16).toUpperCase().padStart(4, '0');
                const glyph = atlasMap[hex];

                if (glyph) {
                    const pageIdx = glyph.p !== undefined ? glyph.p : 0;
                    const sourceImg = atlasImages[pageIdx];

                    if (sourceImg && sourceImg.complete) {
                        ctx.drawImage(
                            sourceImg,
                            glyph.x, glyph.y, glyph.w, glyph.h,
                            cursorX + (glyph.ox * renderScale), 
                            currentY + (glyph.oy * renderScale),
                            glyph.w * renderScale, 
                            glyph.h * renderScale
                        );
                    }
                } 
                else {
                     ctx.fillStyle = "red";
                     ctx.fillRect(cursorX, currentY, 10 * renderScale, targetFontSize);
                }
                cursorX += advance;
            }
            currentY += targetFontSize + LINE_HEIGHT_INC;
        });
    }

    init();
})();