// app.js

const { sequelize } = require('./db');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { setupBreakResetSchedule, setSocketIO } = require('./services/seatResetService');
const { initializeSeats } = require('./services/initializeSeats');
const { User, Seats } = require('./models');
const DuelService = require('./services/duelService');
const DuelTimeoutService = require('./services/DuelTimeoutService');
const retryOperation = require('./utils/retryOperation');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const seatsRouter = require('./routes/seats');
const duelsRouter = require('./routes/duels');
const authRoutes = require('./routes/authRoutes');
const { getUserByTelegramId } = require('./services/authService');

app.use(cors());
app.use(express.json());

// Создание HTTP и WebSocket серверов
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ["*"]
  },
});

// Делаем io доступным глобально
global.io = io;
module.exports = app;
module.exports.get = (key) => {
  if (key === 'io') return global.io;
  return undefined;
};

// Расписание уроков
const schoolSchedule = [
  { start: '08:00', end: '08:40', isBreak: false },
  { start: '08:40', end: '08:50', isBreak: true },
  { start: '08:50', end: '09:30', isBreak: false },
  { start: '09:30', end: '09:40', isBreak: true },
  { start: '09:40', end: '10:20', isBreak: false },
  { start: '10:20', end: '10:40', isBreak: true },
  { start: '10:40', end: '11:20', isBreak: false },
  { start: '11:20', end: '11:40', isBreak: true },
  { start: '11:40', end: '12:20', isBreak: false },
  { start: '12:20', end: '12:30', isBreak: true },
  { start: '12:30', end: '13:10', isBreak: false },
  { start: '13:10', end: '13:20', isBreak: true },
  { start: '13:20', end: '14:00', isBreak: false }
];

app.get('/health-check', (req, res) => {
  res.status(200).send('OK');
});

// Уведомление об обновлении статуса места
const updateSeatStatus = async (seatId) => {
  try {
    const updatedSeat = await Seats.findByPk(seatId);
    if (updatedSeat) {
      const seats = await Seats.findAll();
      io.emit("seatsUpdated", seats);
    }
  } catch (error) {
    console.error("Error emitting seatUpdated event:", error);
  }
};

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Send initial seats data when client connects
  socket.on('requestInitialSeats', async () => {
    try {
      console.log('Received requestInitialSeats from client:', socket.id);
      const seats = await Seats.findAll();
    } catch (error) {
      console.error('Error sending initial seats:', error);
    }
  });

  socket.on('join', async (telegramId) => {
    try {
      if (!telegramId) {
        socket.emit('error', { message: 'User ID is required to join a room.' });
        return;
      }
      const user = await User.findOne({ where: { telegramId } });
      if (user) {
        socket.join(telegramId);
        console.log(`User ${telegramId} joined room ${telegramId}`);
      } else {
        socket.emit('error', { message: 'User not found.' });
      }
    } catch (error) {
      socket.emit('error', { message: 'Failed to join room.' });
    }
  });

  socket.on('updateSeat', async (data) => {
    try {
      const { seatId, userId } = data;

      if (!seatId || !userId) {
        socket.emit('error', { message: 'Необходимо указать ID места и ID пользователя.' });
        return;
      }

      await retryOperation(async () => {
        // Находим и освобождаем предыдущее место пользователя
        const previousSeat = await Seats.findOne({ 
          where: { occupiedBy: userId }
        });
        
        if (previousSeat) {
          await Seats.update(
            { occupiedBy: null },
            { where: { id: previousSeat.id } }
          );
        }

        // Проверяем и обновляем новое место
        const seat = await Seats.findOne({ 
          where: { id: seatId }
        });
        
        if (!seat) {
          throw { message: 'Место не найдено.' };
        }

        if (seat.occupiedBy) {
          throw { message: 'Место уже занято.' };
        }

        // Обновляем статус места
        await Seats.update(
          { occupiedBy: userId },
          { where: { id: seatId } }
        );
      });

      // Получаем обновленный список мест и отправляем всем клиентам
      const seats = await Seats.findAll();
      io.emit('seatsUpdated', seats);
    } catch (error) {
      console.error('Ошибка при обновлении места:', error);
      socket.emit('error', { message: error.message || 'Не удалось обновить место.' });
    }
  });

  socket.on("duelRequest", async (data) => {
    try {
      console.log("Received duel request data:", data);
      const { challengerId, challengedId, seatId, challengerName, challengedName, duelId, createdAt } = data;
  
      if (!challengerId || !challengedId || !seatId) {
        socket.emit('error', { message: 'Invalid duel request data.' });
        return;
      }

      // Emit directly to the challenged player's room since duel is already created
      io.to(challengedId).emit("duelRequest", {
        duelId,
        challengerId,
        challengedId,
        seatId,
        challengerName,
        challengedName,
        createdAt
      });
  
      // Confirmation to challenger
      io.to(challengerId).emit("duelRequestSent", { 
        duelId, 
        challengedId, 
        seatId 
      });
  
    } catch (error) {
      console.error("Ошибка при обработке duelRequest:", error);
      socket.emit('error', { message: error.message || 'Failed to process duel request' });
    }
  });
  
  
  
  socket.on("acceptDuel", async (data) => {
    try {
      const { duelId } = data;

      if (!duelId) {
        socket.emit("error", { message: "Invalid duel ID." });
        return;
      }

      const duel = await DuelService.acceptDuel(duelId);

      // Отправляем событие принятия дуэли всем участникам
      io.to(duel.player1).emit("duelAccepted", {
        duelId: duel.id,
        roleMessage: "Вы 'Орёл' в этой дуэли!",
        request: {
          duelId: duel.id,
          challengerId: duel.player1,
          challengedId: duel.player2,
        },
      });

      io.to(duel.player2).emit("duelAccepted", {
        duelId: duel.id,
        roleMessage: "Вы 'Решка' в этой дуэли!",
        request: {
          duelId: duel.id,
          challengerId: duel.player1,
          challengedId: duel.player2,
        },
      });
    } catch (error) {
      socket.emit("error", { message: error.message || "Failed to accept duel." });
    }
  });

  socket.on("declineDuel", async (data) => {
    try {
      const { duelId } = data;

      if (!duelId) {
        socket.emit('error', { message: 'Invalid duel ID.' });
        return;
      }

      const result = await DuelService.declineDuel(duelId);

      // Проверяем успешность операции
      if (!result.success) {
        socket.emit('error', { message: result.message || 'Failed to decline duel.' });
        return;
      }

      const { duel, updatedSeats } = result;

      // Проверяем наличие duel и его свойств
      if (!duel || !duel.player1 || !duel.player2 || !duel.seatId) {
        socket.emit('error', { message: 'Invalid duel data.' });
        return;
      }

      // Отправляем обновление всех измененных мест всем клиентам
      if (updatedSeats) {
        io.emit('seatsUpdated', updatedSeats);
      }

      // Находим информацию о пользователях
      const initiator = await User.findOne({ where: { telegramId: duel.player1 } });
      const opponent = await User.findOne({ where: { telegramId: duel.player2 } });

      io.emit('duelDeclinedBot', {
        duelId: duel.id,
        challengedId: duel.player2,
        challengerName: initiator?.name || 'Соперник',
        message: "Вы заняли место, так как оппонент отклонил дуэль.",
        duel: {
          seatId: duel.seatId,
          player1: duel.player1,
          player2: duel.player2
        }
      });

      // Отправляем уведомление об отклонении дуэли обоим участникам
      io.to(duel.player1).emit("duelDeclined", {
        duelId: duel.id,
        challengedId: duel.player2,
        message: "Вы заняли место, так как оппонент отклонил дуэль.",
        duel: {
          seatId: duel.seatId,
          player1: duel.player1,
          player2: duel.player2
        }
      });

      io.to(duel.player2).emit("duelDeclined", {
        duelId: duel.id,
        challengedId: duel.player2,
        message: `${initiator?.name || 'Инициатор'} занял место #${duel.seatId}, так как вы отклонили дуэль.`,
        duel: {
          seatId: duel.seatId,
          player1: duel.player1,
          player2: duel.player2
        }
      });
    } catch (error) {
      console.error('Error in declineDuel handler:', error);
      socket.emit('error', { message: error.message || 'Failed to decline duel.' });
    }
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/seats', seatsRouter);
app.use('/duels', duelsRouter);
app.use('/auth', authRoutes);

DuelTimeoutService.start();

// Инициализация при запуске приложения
async function initializeApp() {
  try {
    // Синхронизация базы данных
    await sequelize.sync();
    
    // Инициализация мест
    await initializeSeats();
  
    // Передача Socket.IO в сервис сброса мест
    setSocketIO(io);
    
    // Настройка сброса мест по расписанию уроков
    setupBreakResetSchedule(schoolSchedule);
    
    // Запуск сервера
    server.listen(PORT, () => {
      console.log(`Сервер запущен на порту ${PORT}`);
    });
  } catch (error) {
    console.error('Ошибка инициализации приложения:', error);
  }
}

// Запуск приложения
initializeApp();
