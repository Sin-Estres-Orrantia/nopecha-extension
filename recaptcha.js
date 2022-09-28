(async () => {
    const DEFAULT_SLEEP = [200, 250];


    const {Logger, Time, BG, Net, Image, NopeCHA} = await import(chrome.runtime.getURL('utils.js'));


    function is_widget_frame() {
        return document.querySelector('.recaptcha-checkbox') !== null;
    }


    function is_image_frame() {
        return document.querySelector('#rc-imageselect') !== null;
    }


    function open_image_frame() {
        console.log('open image frame');
        document.querySelector('#recaptcha-anchor')?.click();
    }


    function is_solved() {
        const is_widget_frame_solved = document.querySelector('.recaptcha-checkbox')?.getAttribute('aria-checked') === 'true';
        // Note: verify button is disabled after clicking and during transition to the next image task
        const is_image_frame_solved = document.querySelector('#recaptcha-verify-button')?.disabled;
        return is_widget_frame_solved || is_image_frame_solved;
    }


    function on_images_ready(timeout=15000) {
        return new Promise(async resolve => {
            const start = Time.time();
            while (true) {
                const $tiles = document.querySelectorAll('.rc-imageselect-tile');
                const $loading = document.querySelectorAll('.rc-imageselect-dynamic-selected');
                const is_loaded = $tiles.length > 0 && $loading.length === 0;
                if (is_loaded) {
                    return resolve(true);
                }
                if ((Time.time() - start) > timeout) {
                    return resolve(false);
                }
                await Time.random_sleep(...DEFAULT_SLEEP);
            }
        });
    }


    function get_image_url($e) {
        return $e?.src?.trim();
    }


    function get_lang() {
        let lang = window.navigator.userLanguage || window.navigator.language;
        if (!lang) {
            return null;
        }
        lang = lang.toLowerCase();
        lang = lang.split('-')[0];
        return lang;
    }


    async function get_task(task_lines) {
        let task = null;
        if (task_lines.length > 1) {
            // task = task_lines[1];
            task = task_lines.slice(0, 2).join(' ');
            task = task.replace(/\s+/g, ' ')?.trim();
        }
        else {
            task = task.join('\n');
        }
        if (!task) {
            console.log('error getting task', task);
            return null;
        }

        const lang = get_lang();
        if (lang && lang !== 'en') {
            task = await BG.exec('translate', {from: lang, to: 'en', text: task});
        }

        return task;
    }


    let last_urls_hash = null;
    function on_task_ready(i=100) {
        // Returns urls = [null|url] * 9 if 3x3
        // Returns urls = [null] * 16 if 4x4
        return new Promise(resolve => {
            let checking = false;
            const check_interval = setInterval(async () => {
                if (checking) {
                    return;
                }
                checking = true;

                // let task = null;
                // const task_lines = document.querySelector('.rc-imageselect-instructions')?.innerText?.split('\n');
                // if (task_lines.length > 1) {
                //     // task = task_lines[1];
                //     task = task_lines.slice(0, 2).join(' ');
                //     task = task.replace(/\s+/g, ' ')?.trim();
                // }
                // // const task = document.querySelector('.rc-imageselect-instructions')?.innerText?.replace(/\s+/g, ' ')?.trim();
                // if (!task) {
                //     console.log('no task');
                //     checking = false;
                //     return;
                // }
                // console.log('task', task);

                const task_lines = document.querySelector('.rc-imageselect-instructions')?.innerText?.split('\n');
                let task = await get_task(task_lines);
                if (!task) {
                    checking = false;
                    return;
                }
                console.log('task', task);

                // const task_lines = document.querySelector('.rc-imageselect-instructions')?.innerText?.split('\n');
                const is_hard = (task_lines.length === 3) ? true : false;

                const $cells = document.querySelectorAll('table tr td');
                if ($cells.length !== 9 && $cells.length !== 16) {
                    console.log('invalid number of cells', $cells);
                    checking = false;
                    return;
                }

                const cells = [];
                const urls = Array($cells.length).fill(null);
                let background_url = null;
                let has_secondary_images = false;
                let i = 0;
                for (const $e of $cells) {
                    const $img = $e?.querySelector('img');
                    if (!$img) {
                        console.log('no cell image', $e);
                        checking = false;
                        return;
                    }

                    const url = get_image_url($img);
                    if (!url || url === '') {
                        console.log('no cell image url', $e);
                        checking = false;
                        return;
                    }

                    if ($img.naturalWidth >= 300) {
                        background_url = url;
                    }
                    else if ($img.naturalWidth == 100) {
                        urls[i] = url;
                        has_secondary_images = true;
                    }
                    else {
                        console.log('unknown image size', $img.naturalWidth);
                    }

                    cells.push($e);
                    i++;
                }
                if (has_secondary_images) {
                    background_url = null;
                }

                const urls_hash = JSON.stringify([background_url, urls]);
                if (last_urls_hash === urls_hash) {
                    console.log('task unchanged');
                    checking = false;
                    return;
                }
                last_urls_hash = urls_hash;

                clearInterval(check_interval);
                checking = false;
                return resolve({task, is_hard, cells, background_url, urls});
            }, i);
        });
    }


    function submit() {
        document.querySelector('#recaptcha-verify-button')?.click();
    }


    function got_solve_incorrect() {
        const errors = [
            '.rc-imageselect-incorrect-response',  // try again
        ];
        for (const e of errors) {
            if (document.querySelector(e)?.style['display'] === '') {
                // Logger.log('got solve incorrect', document.querySelector(e));
                return true;
            }
        }
        return false;
    }


    function got_solve_error() {
        const errors = [
            '.rc-imageselect-error-select-more',  // select all matching images
            '.rc-imageselect-error-dynamic-more',  // also check the new images
            '.rc-imageselect-error-select-something',  // select around the object or reload
        ];
        for (const e of errors) {
            if (document.querySelector(e)?.style['display'] === '') {
                // Logger.log('got solve error', document.querySelector(e));
                return true;
            }
        }
        return false;
    }


    function is_cell_selected($cell) {
        try {
            return $cell.classList.contains('rc-imageselect-tileselected');
        } catch {}
        return false;
    }


    async function log_stat() {
        if (!Logger.debug) {
            return;
        }

        let n_success = await BG.exec('get_cache', {name: 'recaptcha_pass', tab_specific: true});
        let n_fail = await BG.exec('get_cache', {name: 'recaptcha_fail', tab_specific: true});
        if (n_success === null) {
            n_success = 0;
        }
        if (n_fail === null) {
            n_fail = 0;
        }
        let success_rate = 0;
        if (n_success + n_fail > 0) {
            success_rate = Math.round((100 * n_success) / (n_success + n_fail));
        }
        // Logger.log(`success_rate: ${success_rate}%`);
        // Logger.log(`success: ${n_success}`);
        // Logger.log(`fail: ${n_fail}`);
    }


    async function inc_pass() {
        await BG.exec('inc_cache', {name: 'recaptcha_pass', tab_specific: true});
        await log_stat();
    }


    async function inc_fail() {
        await BG.exec('inc_cache', {name: 'recaptcha_fail', tab_specific: true});
        await log_stat();
    }


    async function on_widget_frame(settings) {
        // Wait if already solved
        if (is_solved()) {
            if (!was_solved) {
                // await report(true);
                await inc_pass();
                was_solved = true;
            }
            // Collect data
            if (settings.debug) {
                await BG.exec('reset_recaptcha');
            }
            return;
        }
        was_solved = false;
        await Time.sleep(settings.recaptcha_open_delay);
        open_image_frame();
    }


    async function on_image_frame(settings) {
        if (settings.debug) {
            await BG.exec('reload_tab', {delay: 300 * 1000, overwrite: true});
        }

        // Check if parent frame marked this frame as visible on screen
        const is_visible = await BG.exec('get_cache', {name: 'recaptcha_visible', tab_specific: true});
        if (is_visible !== true) {
            return;
        }

        // Wait if verify button is disabled
        if (is_solved()) {
            return;
        }

        // Incorrect solution
        if (!was_incorrect && got_solve_incorrect()) {
            solved_urls = [];
            // await report(false);
            await inc_fail();
            was_incorrect = true;
        }
        else {
            was_incorrect = false;
        }

        // Select more images error
        if (got_solve_error()) {
            solved_urls = [];
            // await report(false);
            await BG.exec('reset_recaptcha');
            return;
        }

        // Wait for images to load
        const is_ready = await on_images_ready();
        if (!is_ready) {
            // Logger.log('waited too long for images to load');
            await BG.exec('reset_recaptcha');
            return;
        }

        // Wait for task to be available
        const {task, is_hard, cells, background_url, urls} = await on_task_ready();
        // console.log(task, is_hard, cells, urls);
        const n = cells.length == 9 ? 3 : 4;

        // Convert image urls to blobs
        let images = [];
        let grid;
        let clickable_cells = [];  // Variable number of clickable cells if secondary images appear
        if (background_url === null) {
            grid = '1x1';  // Grid len (1x1 for secondary images)
            for (let i = 0; i < urls.length; i++) {
                const url = urls[i];
                const cell = cells[i];
                if (url && !solved_urls.includes(url)) {
                    images.push(await Image.encode(url));
                    clickable_cells.push(cell);
                }
            }
        }
        else {
            const background_image = await Image.encode(background_url);
            images.push(background_image);
            if (background_image === null) {
                await BG.exec('reset_recaptcha');
            }
            grid = `${n}x${n}`;
            clickable_cells = cells;
        }
        // Logger.log('images', images.length, j, g, urls, background_url);

        // await Time.sleep(settings.solve_delay);
        const solve_start = Time.time();

        // Solve task
        const captcha_type = 'recaptcha';
        const key = settings.key;
        // const {job_id, clicks} = await solve({task, images, grid});
        const {job_id, clicks} = await NopeCHA.post({captcha_type, task, images, grid, key});
        // Logger.log(clicks);
        if (!clicks) {
            // Logger.log('no clicks', task, images, j, g, job_id, clicks);
            return;
        }

        const delta = settings.recaptcha_solve_delay - (Time.time() - solve_start);
        if (delta > 0) {
            await Time.sleep(delta);
        }

        // // Cache results to report when graded
        // await BG.exec('append_cache', {name: 'job_id', value: job_id, tab_specific: true});


        // Submit solution
        await Time.random_sleep(...DEFAULT_SLEEP);

        let n_clicks = 0;
        for (let i = 0; i < clicks.length; i++) {
            if (clicks[i] === false) {
                continue;
            }
            n_clicks++;

            // Click if not already selected
            if (!is_cell_selected(clickable_cells[i])) {
                clickable_cells[i]?.click();
            }
        }

        for (const url of urls) {
            solved_urls.push(url);
            if (solved_urls.length > 9) {
                solved_urls.shift();
            }
        }

        await Time.random_sleep(...DEFAULT_SLEEP);

        // if ((n === 3 && result.length === 0 && images_loaded()) || n === 4) {
        if ((n === 3 && is_hard && n_clicks === 0 && await on_images_ready()) || (n === 3 && !is_hard) || n === 4) {
            submit();
        }
    }


    async function check_image_frame_visibility() {
        // const $image_frames = [];
        // $image_frames.push(...document.querySelectorAll('iframe[src*="/recaptcha/api2/bframe"]'));
        // $image_frames.push(...document.querySelectorAll('iframe[src*="/recaptcha/enterprise/bframe"]'));
        const $image_frames = document.querySelectorAll('iframe[src*="/bframe"]');
        if ($image_frames.length > 0) {
            let is_visible = false;
            for (const $image_frame of $image_frames) {
                is_visible = window.getComputedStyle($image_frame).visibility === 'visible';
                if (is_visible) {
                    break;
                }
            }
            if (is_visible) {
                await BG.exec('set_cache', {name: 'recaptcha_visible', value: true, tab_specific: true});
            }
            else {
                await BG.exec('set_cache', {name: 'recaptcha_visible', value: false, tab_specific: true});
            }
        }
    }


    let was_solved = false;
    let was_incorrect = false;
    let solved_urls = [];


    while (true) {
        await Time.sleep(1000);

        const settings = await BG.exec('get_settings');

        // Using another solve method
        if (!settings || settings.recaptcha_solve_method !== 'image') {
            continue;
        }
        Logger.debug = settings.debug;

        check_image_frame_visibility();

        if (settings.recaptcha_auto_open && is_widget_frame()) {
            await on_widget_frame(settings);
        }
        else if (settings.recaptcha_auto_solve && is_image_frame()) {
            await on_image_frame(settings);
        }
    }
})();
