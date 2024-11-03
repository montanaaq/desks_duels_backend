const axios = require('axios');
const io = require('../app').io; // Экспортируйте io из app.js

async function occupySeat(userId, seatId) {
  try {
    const response = await axios.put(`/seats/${seatId}/occupy`, { userId });
    const updatedSeat = response.data;

    io.emit('seatUpdated', updatedSeat); // Отправляем обновление
    return updatedSeat;
  } catch (error) {
    console.error('Error occupying seat:', error);
  }
}

module.exports = { occupySeat };
