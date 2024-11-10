// models/index.js

const User = require('./User');
const Seats = require('./Seats');
const Duel = require('./Duel');

// Synchronize models with the database
const syncModels = async () => {
    try {
        await User.sync();
        await Seats.sync();
        await Duel.sync();
        console.log('All models were synchronized successfully.');
    } catch (error) {
        console.error('Error synchronizing models:', error);
    }
};

syncModels();

module.exports = {
    User,
    Seats,
    Duel,
};
