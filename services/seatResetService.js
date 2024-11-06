const cron = require('node-cron');
const Seats = require('../models/Seats'); // Импорт модели Seats

// Сброс всех мест
async function resetAllSeats() {
	try {
		await Seats.update({occupiedBy: null, isRed: false}, {where: {}});
		console.log("Все места успешно сброшены.");
	} catch (error) {
		console.error("Ошибка при сбросе мест:", error);
	}
}

// Запуск задачи по расписанию
function scheduleSeatReset() {
	const schedule = [
		"35 7 * * 1-5", // 07:35, перед 1-м уроком (08:00)
		"25 9 * * 1-5", // 09:25, перед 2-м уроком (08:50)
		"15 10 * * 1-5", // 10:15, перед 3-м уроком (09:40)
		"15 11 * * 1-5", // 11:15, перед 4-м уроком (10:40)
		"15 12 * * 1-5", // 12:15, перед 5-м уроком (11:40)
		"5 13 * * 1-5",  // 13:05, перед 6-м уроком (12:30)
		"55 13 * * 1-5", // 13:55, перед 7-м уроком (13:20)
	];

	schedule.forEach((time) => {
		cron.schedule(time, resetAllSeats);
	});

	console.log("Запланированные задачи на сброс мест успешно настроены.");
}

module.exports = {scheduleSeatReset};
