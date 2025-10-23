import express from 'express';
import mongoose from 'mongoose';
import session from 'express-session';
import bcrypt from 'bcrypt';
import path from 'path';
import { fileURLToPath } from 'url';
import User from './models/user.js'; 
import Course from './models/course.js'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();


mongoose.connect('mongodb+srv://santhsim:ramya@cluster0.eiszn14.mongodb.net/')
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error(err));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: false
}));


function ensureLoggedIn(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/student/login');
  }
  next();
}

function ensureStudent(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'student') {
    return res.redirect('/student/login');
  }
  next();
}

function ensureTeacher(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/teacher/login');
  }
  next();
}




app.get('/student/login', (req, res) => res.render('studentLogin'));
app.get('/teacher/login', (req, res) => res.render('teacherLogin'));
app.get('/student/signup', (req, res) => res.render('studentSignup'));
app.get('/teacher/signup', (req, res) => res.render('teacherSignup'));

app.post('/signup', async (req, res) => {
  const { username, password, role, USN } = req.body;

  const hashed = await bcrypt.hash(password, 10);
  await User.create({ username, password: hashed, role, usn: USN });

  res.redirect(`/${role}/login`);
});

app.post('/login', async (req, res) => {
  const { username, password, role } = req.body;
  const user = await User.findOne({ username, role });

  if (user && await bcrypt.compare(password, user.password)) {
    req.session.user = user;

    if (role === 'teacher') {
      res.redirect('/teacher/dashboard');
    } else {
      res.redirect('/dashboard');
    }
  } else {
    res.send('Invalid credentials');
  }
});

app.get('/dashboard', ensureStudent, async (req, res) => {
  const courses = await Course.find();
  res.render('dashboard', { user: req.session.user, courses });
});

app.get('/teacher/dashboard', ensureTeacher, async (req, res) => {
  const students = await User.find({ role: 'student' });
  const courses = await Course.find();
  res.render('teacherDashboard', { teacher: req.session.user, students, courses });
});

app.post('/teacher/add-course', ensureTeacher, async (req, res) => {
  const { title, image, link } = req.body;
  await Course.create({ title, image, link });
  res.redirect('/teacher/dashboard');
});


app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/student/login');
  });
});

app.listen(3000, () => console.log('Listening on port 3000'));
