const {sequelize} = require('./db');
const express = require('express');
const app = express();
const cors = require('cors');
const http = require('http');
const {Server} = require('socket.io');
const {scheduleSeatReset} = require('./services/seatScheduler'); // Импортируем расписание
const {initializeSeats} = require('./services/initializeSeats');

require('dotenv').config();

const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const seatsRouter = require('./routes/seats');
const duelsRouter = require('./routes/duels');
const authRoutes = require('./routes/authRoutes');

app.use(express.json());
app.use(cors());

// Настраиваем HTTP и WebSocket серверы
const server = http.createServer(app);
const io = new Server(server, {
	cors: {
		origin: '*', // Замените * на нужный URL, если нужно ограничить доступ
		methods: ['GET', 'POST']
	}
});

// Отслеживаем подключение, отключение и пинг-понг
io.on('connection', (socket) => {
	console.log(`User connected: ${socket.id}`);

	// Пинг-понг для стабильности соединения
	socket.on('ping', () => {
		console.log(`Received ping from ${socket.id}`);
		socket.emit('pong');
	});

	socket.on('seatOccupied', (updatedSeat) => {
		io.emit('seatUpdated', updatedSeat); // Отправляем обновление всем пользователям
		console.log(`Seat updated: ${updatedSeat.id}`); // Логируем обновление
	});

	socket.on('disconnect', () => {
		console.log(`User disconnected: ${socket.id}`);
	});
});

app.use('/', indexRouter);
app.use('/auth', authRoutes);
app.use('/users', usersRouter);
app.use('/seats', seatsRouter);
app.use('/duels', duelsRouter);

// Синхронизация базы данных и запуск сервера
sequelize.sync().then(async () => {
	await initializeSeats(); // Инициализация мест
	scheduleSeatReset(); // Запускаем расписание сброса мест
	server.listen(3000, () => {
		console.log('Server is running on port 3000, Press Ctrl+C to quit.');
	});
}).catch(error => console.error('Error syncing database:', error));
