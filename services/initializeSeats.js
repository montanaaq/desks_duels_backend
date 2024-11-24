// services/initializeSeats.js

const Seats = require('../models/Seats'); // Импорт модели Seats

// Функция для инициализации мест
async function initializeSeats() {
    try {
        const seatCount = await Seats.count();

        // Если мест меньше 36, создаем недостающие места
        if (seatCount < 36) {
            // Очищаем таблицу и создаем ровно 36 мест
            await Seats.destroy({ where: {} }); // Удаляем все записи

            const seats = generateSeats();

            // Массовое создание мест
            await Seats.bulkCreate(seats);
            console.log('Создано 36 мест');
        } else {
            console.log('Места уже созданы. Синхронизация не требуется.');
        }
    } catch (error) {
        console.error('Ошибка при инициализации мест:', error);
    }
}

function generateSeats() {
    const seats = [];
    const rows = 3;
    const desksPerRow = 6;

    for (let row = 1; row <= rows; row++) {
        for (let desk = 1; desk <= desksPerRow; desk++) {
            for (let variant = 1; variant <= 2; variant++) {
                seats.push({
                    rowNumber: row,
                    deskNumber: desk,
                    variant: variant,
                    status: 'available'
                });
            }
        }
    }

    return seats;
}

module.exports = { initializeSeats };
