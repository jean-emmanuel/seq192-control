// Seq192 constants
SEQ192_COLS = 14
SEQ192_ROWS = 13

// Seq192 config
SEQ192_PORT = 10000
SEQ192_HOST = '127.0.0.1'

// UI config
DISPLAY_COLS = 8
DISPLAY_ROWS = 8
ENABLE_PROGRESS_BARS = 1 // laggy with big screensets
REFRESH_RATE = 20

// Internals
LAST_STATUS = ''

class Sequence {

    constructor(parent, row, col) {

        this.row = row
        this.col = col
        this.parent = parent
        this.active = 0
        this.playing = 0
        this.recording = 0
        this.queued = 0
        this.ticks = 1
        this.time = ''
        this.name = ''
        this.timesPlayed = 0

    }

    update(data) {

        var dirty = false
        for (var prop in data) {
            let val = data[prop]
            if (this[prop] !== undefined && val != this[prop]) {
                this[prop] = val
                dirty = true
            }
        }
        if (dirty && !this.parent.dirtySequences.includes(this)) {
            this.parent.dirtySequences.push(this)
        }

        return dirty


    }

    toJSON() {

        return JSON.stringify({
            active: this.active,
            recording: this.recording,
            on: this.playing,
            queued: this.queued,
            time: this.time,
            name: this.name,
            ticks: this.ticks
        })

    }

}

class Seq192 {

    constructor(rows, cols) {

        if (ENABLE_PROGRESS_BARS) {
            this.tick = 0
        }
        this.bpm = 120
        this.playing = 0
        this.screenset = 0
        this.screensetName = ''
        this.rows = rows
        this.cols = cols
        this.sequences = []
        for (var c = 0; c <= cols; c++) {
            for (var r = 0; r <= rows; r++) {
                this.sequences.push(new Sequence(this, r, c))
            }
        }
        this.activeSequences = []
        this.oldActiveSequences = []
        this.dirtySequences = []

        this.seqMode = 'toggle'
        this.playMode = 'normal'

    }

    update(data) {

        if (data.sequences) {
            this.oldActiveSequences = this.activeSequences.slice()
            this.activeSequences = []
        }


        for (var prop in data) {
            var val = data[prop]

            if (prop === 'sequences') {
                for (var seqdata of val) {
                    var n = seqdata.row + seqdata.col * this.rows

                    if (this.sequences[n]) {
                        this.sequences[n].update(seqdata)
                        this.sequences[n].update({active: 1})
                        this.activeSequences.push(n)
                    }
                }
            } else {

                if (this[prop] !== undefined && val != this[prop]) {
                    this[prop] = val
                    receive('/seq192/' + prop, val)
                }
            }
        }

        if (data.sequences) {

            // update inactive sequences
            for (let i of this.oldActiveSequences) {
                if (!this.activeSequences.includes(i)) {
                    this.sequences[i].update({active: 0})
                }
            }

            // send dirty sequences updates to gui
            if (this.dirtySequences.length) {
                var script = ''
                for (let s of this.dirtySequences) {
                    // TODO: receive new data
                    script += `setVar('seq192/${s.col}/${s.row}', 'data', ${s.toJSON()});`
                }
                receive('/SCRIPT', script)
                this.dirtySequences = []
            }

        }

    }

    setSeqMode(mode) {

        if (!['on', 'off', 'toggle', 'solo', 'record', 'clear'].includes(mode)) return

        this.seqMode = mode

    }

    setPlayMode(mode) {

        if (!['normal', 'trig', 'queued'].includes(mode)) return

        this.playMode = mode

    }

    send() {

        send(SEQ192_HOST, SEQ192_PORT, ...arguments)

    }

}

var seq192 = new Seq192(SEQ192_ROWS, SEQ192_COLS)

setInterval(()=>{

    seq192.send('/status/extended')

}, 1000 / REFRESH_RATE )

app.on('sessionOpened', (data, client)=>{

    // force recalc on reload
    LAST_STATUS = ''
    seq192.playing = -1
    seq192.sequences.forEach(x=>x.active=0)
    receive('/seqMode', seq192.seqMode)
    receive('/playMode', seq192.playMode)
    receive('/cols', DISPLAY_COLS)
    receive('/rows', DISPLAY_ROWS)
    if (ENABLE_PROGRESS_BARS) receive('/showProgress', 1)

})


module.exports = {

    oscInFilter: (data)=>{

        var {address, args, host, port} = data

        if (port === SEQ192_PORT) {

            var newStatus = args[0].value
            if (newStatus != LAST_STATUS) seq192.update(JSON.parse(newStatus))
            LAST_STATUS = newStatus

            return

        }

        return {address, args, host, port}

    },

    oscOutFilter: (data)=>{

        var {address, args, host, port} = data

        if (host === 'seq192') {

            if (port === 'osc') {

                if (address === '/sequence') {

                    if (seq192.playMode === 'trig') address = '/sequence/trig'
                    if (seq192.playMode === 'queued') address = '/sequence/queue'

                    if (args[0].type !== 's') args.unshift({type: 's', value: seq192.seqMode})

                }

                host = SEQ192_HOST
                port = SEQ192_PORT

                setTimeout(()=>{

                    seq192.send('/status/extended')

                })

            } else {

                if (address === '/seqMode') seq192.setSeqMode(args[0].value)
                else if (address === '/playMode') seq192.setPlayMode(args[0].value)

                return

            }

        }

        return {address, args, host, port}

    }

}
