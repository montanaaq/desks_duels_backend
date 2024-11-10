'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS unique_active_duel_per_seat 
            ON Duel (seatId) 
            WHERE status IN ('pending', 'accepted');
        `);
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.sequelize.query(`
            DROP INDEX IF EXISTS unique_active_duel_per_seat;
        `);
    }
};
