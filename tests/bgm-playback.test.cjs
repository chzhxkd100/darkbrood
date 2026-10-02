const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/js/global.js'), 'utf8');
const start = source.indexOf('(function()', source.indexOf('// Dark Aero MP3 Stick Player'));
const playerSource = source.slice(start, source.indexOf('})();', start) + 5);
const playlist = ['a', 'b', 'c', 'd'].map(id => ({ id, fileUrl: id, title: id }));

async function createPlayer({ tracks = playlist, storage = new Map(), random = () => 0.8 } = {}) {
    const elements = new Map();
    for (const id of ['darkbroodAudio', 'bgmNextBtn', 'bgmPrevBtn', 'bgmPlayBtn']) {
        elements.set(id, {
            events: {}, paused: true, currentTime: 0, duration: 100,
            addEventListener(event, callback) { this.events[event] = callback; },
            load() { this.currentTime = 0; this.paused = true; },
            play() { this.paused = false; return Promise.resolve(); },
            pause() { this.paused = true; }
        });
    }
    const context = {
        document: {
            body: { getAttribute() { return 'false'; }, setAttribute() {} },
            getElementById: id => elements.get(id) || null,
            querySelectorAll: () => [], querySelector: () => null,
            addEventListener() {}, removeEventListener() {}
        },
        window: {}, console, setTimeout,
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        Math: Object.assign(Object.create(Math), { random }),
        fetch: async () => ({ json: async () => ({ success: true, tracks: [...tracks] }) }),
        confirm: () => true,
        alert: message => assert.fail(message)
    };
    vm.runInNewContext(playerSource, context);
    await new Promise(resolve => setImmediate(resolve));
    return {
        audio: elements.get('darkbroodAudio'), storage, window: context.window,
        next: () => elements.get('bgmNextBtn').events.click(),
        prev: () => elements.get('bgmPrevBtn').events.click()
    };
}

test('first track is random; Next and ended exhaust each cycle without repeats', async () => {
    const player = await createPlayer();
    assert.equal(player.audio.src, 'd');
    let last;
    for (let cycle = 0; cycle < 20; cycle++) {
        const heard = [];
        for (let index = 0; index < playlist.length; index++) {
            if (cycle || index) {
                if (index % 2) player.next();
                else player.audio.events.ended();
            }
            assert.notEqual(player.audio.src, last);
            last = player.audio.src;
            heard.push(last);
        }
        assert.equal(new Set(heard).size, playlist.length);
    }
});

test('different random input produces a different first track', async () => {
    assert.equal((await createPlayer({ random: () => 0 })).audio.src, 'a');
    assert.equal((await createPlayer({ random: () => 0.5 })).audio.src, 'c');
});

test('reload resumes position and preserves the unplayed set', async () => {
    const player = await createPlayer();
    const first = player.audio.src;
    player.next();
    const second = player.audio.src;
    player.audio.currentTime = 35;
    player.audio.events.timeupdate();
    const resumed = await createPlayer({ storage: player.storage });
    assert.equal(resumed.audio.src, second);
    assert.equal(resumed.audio.currentTime, 35);
    resumed.next();
    const third = resumed.audio.src;
    resumed.next();
    assert.equal(new Set([first, second, third, resumed.audio.src]).size, 4);
});

test('Previous follows history; Next still selects an unplayed track', async () => {
    const player = await createPlayer();
    const first = player.audio.src;
    player.next();
    const second = player.audio.src;
    player.prev();
    assert.equal(player.audio.src, first);
    player.next();
    assert.ok(![first, second].includes(player.audio.src));
});

test('manual selection and newly uploaded tracks count toward the current cycle', async () => {
    const player = await createPlayer();
    player.window.playBgmTrackById('b');
    player.window.addNewBgmTracks([{ id: 'e', fileUrl: 'e', title: 'e' }]);
    assert.equal(player.audio.src, 'e');
    player.next();
    const next = player.audio.src;
    player.next();
    assert.deepEqual(new Set([next, player.audio.src]), new Set(['a', 'c']));
});

test('deleting the current track advances to an unplayed track', async () => {
    const player = await createPlayer();
    player.next();
    await player.window.deleteBgmTrack(player.audio.src);
    const next = player.audio.src;
    player.next();
    assert.deepEqual(new Set([next, player.audio.src]), new Set(['a', 'b']));
});

test('empty and single-track playlists are supported', async () => {
    const empty = await createPlayer({ tracks: [] });
    empty.next();
    assert.equal(empty.audio.src, undefined);
    const single = await createPlayer({ tracks: playlist.slice(0, 1) });
    single.audio.currentTime = 10;
    single.next();
    assert.equal(single.audio.src, 'a');
    assert.equal(single.audio.currentTime, 0);
});

test('invalid saved history and removed saved tracks do not prevent playback', async () => {
    const storage = new Map([
        ['darkbrood_bgm_played_track_ids', '{broken'],
        ['darkbrood_bgm_track_id', 'removed'],
        ['darkbrood_bgm_time', '90']
    ]);
    const player = await createPlayer({ storage });
    assert.equal(player.audio.src, 'd');
    assert.equal(player.audio.currentTime, 0);
    player.next();
    assert.notEqual(player.audio.src, 'd');
});
