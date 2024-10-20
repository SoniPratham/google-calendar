const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const EventSchema = new Schema({
    id: {
        type: String,
        required: true,
        unique: true,
    },
    start: {
        type: String,
    },
    end: {
        type: String,
    },
    status: {
        type: String,
    },
    creator: {
        type: Array,
    },
    description: {
        type: String,
    }
});

module.exports = mongoose.model('Event', EventSchema);