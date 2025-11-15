import express from 'express';
import mongoose from 'mongoose';
import session from 'express-session';
import bcrypt from 'bcrypt';
import path from 'path';
import { fileURLToPath } from 'url';
import User from './models/user.js'; 
import Course from './models/course.js'; 
import dotenv from 'dotenv';
import { Ollama } from 'ollama';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Configure Ollama for cloud usage
const ollama = new Ollama({
  host: 'https://ollama.com',
  headers: {
    'Authorization': `Bearer ${process.env.OLLAMA_API_KEY}`
  }
});

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => 
  {
    console.log("Loaded MONGODB_URI =", process.env.MONGODB_URI);
    console.log('MongoDB Connected');
  })
  .catch(err => console.error(err));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
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


// Root route - Landing page
app.get('/', (req, res) => res.render('index'));

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
  const user = await User.findById(req.session.user._id).populate('enrolledCourses');
  const courses = await Course.find();
  res.render('dashboard', { user, courses });
});

app.get('/teacher/dashboard', ensureTeacher, async (req, res) => {
  const teacherId = req.session.user._id;
  const courses = await Course.find({ teacher: teacherId }).populate('enrolledStudents');
  
  // Get unique students enrolled in any of this teacher's courses
  const studentIds = new Set();
  courses.forEach(course => {
    course.enrolledStudents.forEach(student => {
      studentIds.add(student._id.toString());
    });
  });
  
  const students = await User.find({ _id: { $in: Array.from(studentIds) } });
  
  res.render('teacherDashboard', { teacher: req.session.user, students, courses });
});

app.post('/teacher/add-course', ensureTeacher, async (req, res) => {
  const { title, description, image, link } = req.body;
  await Course.create({ 
    title,
    description, 
    image, 
    link, 
    teacher: req.session.user._id,
    enrolledStudents: []
  });
  res.redirect('/teacher/dashboard');
});

app.post('/teacher/delete-course/:id', ensureTeacher, async (req, res) => {
  const courseId = req.params.id;
  const course = await Course.findById(courseId);
  
  // Verify the course belongs to this teacher
  if (!course || course.teacher.toString() !== req.session.user._id.toString()) {
    return res.status(403).send('Unauthorized');
  }
  
  // Remove course from all enrolled students
  await User.updateMany(
    { enrolledCourses: courseId },
    { $pull: { enrolledCourses: courseId } }
  );
  
  // Delete the course
  await Course.findByIdAndDelete(courseId);
  res.redirect('/teacher/dashboard');
});

app.post('/teacher/edit-course/:id', ensureTeacher, async (req, res) => {
  const courseId = req.params.id;
  const { title, description, image, link } = req.body;
  const course = await Course.findById(courseId);
  
  // Verify the course belongs to this teacher
  if (!course || course.teacher.toString() !== req.session.user._id.toString()) {
    return res.status(403).send('Unauthorized');
  }
  
  // Update the course
  await Course.findByIdAndUpdate(courseId, {
    title,
    description,
    image,
    link
  });
  
  res.redirect('/teacher/dashboard');
});

app.post('/register-course', ensureStudent, async (req, res) => {
  const { courseId } = req.body;
  const userId = req.session.user._id;
  
  // Add student to course's enrolledStudents
  await Course.findByIdAndUpdate(courseId, {
    $addToSet: { enrolledStudents: userId }
  });
  
  // Add course to student's enrolledCourses
  await User.findByIdAndUpdate(userId, {
    $addToSet: { enrolledCourses: courseId }
  });
  
  res.redirect('/dashboard');
});

app.post('/api/chat', ensureLoggedIn, async (req, res) => {
  try {
    const { message } = req.body;
    
    // Get all available courses for context
    const courses = await Course.find().populate('teacher', 'username');
    
    // Check if the message is asking about courses or just general conversation
    const courseRelatedKeywords = ['course', 'learn', 'study', 'teach', 'tutorial', 'training', 'class', 'education', 'want', 'need', 'looking for', 'recommend', 'suggest', 'which', 'what', 'show me', 'find'];
    const isCourseLookup = courseRelatedKeywords.some(keyword => message.toLowerCase().includes(keyword));
    
    let contextualMessage;
    
    if (!isCourseLookup) {
      // General conversation - no course filtering needed
      let platformContext = `\n\nPlatform features the student can see:
- Available courses displayed as cards with images and titles
- Each course has a "Go to Course" link and a "Register" button
- Students can enroll in courses they're interested in
- The chatbot (you) can help them find the right courses
- Total courses available: ${courses.length}`;
      
      if (courses.length > 0) {
        platformContext += `\n- Current courses: ${courses.map(c => c.title).join(', ')}`;
      }
      
      contextualMessage = `You are a friendly AI learning assistant for an online education platform.
${platformContext}

The student said: "${message}"

Respond in a helpful and friendly way. Keep your response brief and conversational. 

If they seem confused or ask for help:
- Let them know they can browse courses on the page
- Tell them they can ask you to recommend courses based on what they want to learn
- Explain they can register for courses by clicking the Register button
- Mention they can ask you questions like "I want to learn React" or "What courses do you have?"

If it's just a greeting or casual chat, respond warmly and let them know you're here to help them find courses.`;
      
      const response = await ollama.chat({
        model: 'gpt-oss:20b',
        messages: [{ role: 'user', content: contextualMessage }],
        stream: false
      });
      
      return res.json({ 
        reply: response.message.content,
        recommendedCourses: []
      });
    }
    
    // Course-related query - proceed with filtering
    const questionLower = message.toLowerCase();
    
    // Filter courses based on relevance to the question
    const relevantCourses = courses.filter(course => {
      const titleLower = course.title.toLowerCase();
      const descLower = (course.description || '').toLowerCase();
      const combinedText = titleLower + ' ' + descLower;
      
      // Extract potential topic keywords from the question
      let keywords = questionLower
        .replace(/\b(i want|i need|looking for|course|courses|about|on|with|in|the|a|an|concepts?|topics?|consists?|of|contains?|has|have|teaches?|covers?|tell me|show me|find|recommend|suggest|any|all|select|give|list|which is|that is|related to|me|can|you|u|as)\b/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(word => word.length > 1); // Keep words with at least 2 characters
      
      // Remove duplicates
      keywords = [...new Set(keywords)];
      
      // If no meaningful keywords extracted, return false
      if (keywords.length === 0) {
        return false;
      }
      
      // Course must have description or title content
      if ((!course.description || course.description.trim() === '') && titleLower.trim() === '') {
        return false;
      }
      
      // Special handling for common abbreviations and terms
      const expansions = {
        'ai': ['artificial intelligence', 'a.i.', ' ai ', 'gen ai', 'generative ai'],
        'ml': ['machine learning', 'm.l.', ' ml '],
        'dl': ['deep learning', 'd.l.', ' dl '],
        'nlp': ['natural language processing'],
        'cv': ['computer vision'],
        'gen': ['generative', 'generation'],
        'python': [' py ', 'python'],
        'javascript': ['js', 'node', 'javascript'],
        'data': ['analytics', 'analysis', 'data'],
        'web': ['website', 'web development', 'web dev'],
        'react': ['react', 'reactjs', 'react.js'],
        'vue': ['vue', 'vuejs', 'vue.js'],
        'angular': ['angular', 'angularjs']
      };
      
      // Check if ANY keyword matches (use .some() instead of .every())
      return keywords.some(keyword => {
        // First check direct match in combined text
        if (combinedText.includes(keyword)) {
          return true;
        }
        
        // Check if the keyword has known expansions
        if (expansions[keyword]) {
          return expansions[keyword].some(expansion => combinedText.includes(expansion));
        }
        
        // If no direct match or expansion, keyword doesn't match
        return false;
      });
    });
    
    // Build context for AI using only relevant courses
    let courseContext = '';
    let courseMap = {};
    
    if (relevantCourses.length > 0) {
      courseContext = '\n\n=== MATCHING COURSES FROM DATABASE ===\n\n';
      
      relevantCourses.forEach((course, index) => {
        const courseNum = index + 1;
        courseMap[courseNum] = course._id.toString();
        
        courseContext += `Course ${courseNum}:\n`;
        courseContext += `Title: ${course.title}\n`;
        courseContext += `Description: ${course.description}\n\n`;
      });
      
      courseContext += '=== END OF COURSES ===\n';
    } else {
      courseContext = '\n\n=== NO MATCHING COURSES FOUND IN DATABASE ===\n';
      courseContext += 'No courses in the database have descriptions that match the student\'s query.\n';
    }
    
    // Create context-aware prompt with very strict rules
    
    if (relevantCourses.length > 0) {
      // Detect if user is asking for comparison or explanation
      const wantsComparison = /\b(difference|compare|between|vs|versus)\b/i.test(message);
      const wantsExplanation = /\b(explain|tell|what is|describe)\b/i.test(message);
      
      // Build course information
      let courseInfo = '';
      relevantCourses.forEach((course, index) => {
        const courseNum = index + 1;
        courseMap[courseNum] = course._id.toString();
        courseInfo += `Course ${courseNum}: "${course.title}"\n`;
        courseInfo += `Description: ${course.description}\n\n`;
      });
      
      // We have matching courses - ask AI to respond naturally
      contextualMessage = `You are a helpful and conversational course advisor chatbot. A student is asking about courses.

AVAILABLE COURSES:
${courseInfo}

STUDENT'S QUESTION: "${message}"

INSTRUCTIONS:
- Be conversational and natural - talk like a friendly advisor, not a formal system
- Use the exact course titles in bold: **${relevantCourses[0].title}**
- Explain what each course teaches in your own words based on the description
- If comparing courses, highlight key differences in a natural, easy-to-understand way
- If explaining, break down the topics covered and who it's good for
- Keep responses clear but engaging - use phrases like "This course focuses on...", "You'll learn...", "It's perfect for..."
- Don't just copy-paste the description - explain it conversationally

${wantsComparison ? 'The student wants to understand differences between courses. Explain how they differ in focus, topics, and target skills.' : ''}
${wantsExplanation ? 'The student wants an explanation. Break down what the course(s) teach and what skills they\'ll gain.' : ''}

Respond naturally and helpfully!`;
    } else {
      // No matching courses - tell AI to say so
      contextualMessage = `The student asked: "${message}"

We searched our database and found ZERO courses that match this topic.

Respond with a short, direct message like: "Sorry, we don't have any courses on that topic right now."

Keep it brief and simple.`;
    }
    
    const response = await ollama.chat({
      model: 'gpt-oss:20b',
      messages: [{ role: 'user', content: contextualMessage }],
      stream: false
    });
    
    // Extract course numbers from AI response
    const aiReply = response.message.content;
    const recommendedCourseIds = [];
    
    // Method 1: Look for "Course X" pattern in the response
    const coursePattern = /\b[Cc]ourse\s+(\d+)\b/g;
    const matches = [...aiReply.matchAll(coursePattern)];
    
    matches.forEach(match => {
      const num = parseInt(match[1]);
      if (courseMap[num]) {
        recommendedCourseIds.push(courseMap[num]);
      }
    });
    
    // Method 2: Check if any course titles are mentioned (more reliable)
    if (recommendedCourseIds.length === 0 && relevantCourses.length > 0) {
      relevantCourses.forEach(course => {
        // Check if the course title appears in the AI response
        // Use case-insensitive matching and check for partial matches
        const titleWords = course.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const aiReplyLower = aiReply.toLowerCase();
        
        // If at least 2 significant words from title appear, or the title contains special terms
        const matchCount = titleWords.filter(word => aiReplyLower.includes(word)).length;
        if (matchCount >= Math.min(2, titleWords.length) || aiReplyLower.includes(course.title.toLowerCase())) {
          recommendedCourseIds.push(course._id.toString());
        }
      });
    }
    
    // Method 3: If AI provided a meaningful response and we have relevant courses, recommend them all
    if (recommendedCourseIds.length === 0 && relevantCourses.length > 0 && 
        !aiReply.toLowerCase().includes("don't have") && 
        !aiReply.toLowerCase().includes("not available") &&
        !aiReply.toLowerCase().includes("no courses") &&
        aiReply.length > 50) { // AI gave a substantial response
      // Add all relevant courses as recommendations
      relevantCourses.forEach(course => {
        recommendedCourseIds.push(course._id.toString());
      });
    }
    
    // Remove duplicates
    const uniqueCourseIds = [...new Set(recommendedCourseIds)];
    
    console.log('===== CHATBOT DEBUG =====');
    console.log('Student Question:', message);
    console.log('Is Course Lookup:', isCourseLookup);
    console.log('Total Courses in DB:', courses.length);
    console.log('Matching Courses Found:', relevantCourses.length);
    if (relevantCourses.length > 0) {
      console.log('Matching Course Titles:', relevantCourses.map(c => c.title));
    }
    console.log('AI Reply:', aiReply);
    console.log('Recommended Course IDs:', uniqueCourseIds);
    console.log('========================');
    
    res.json({ 
      reply: aiReply,
      recommendedCourses: uniqueCourseIds
    });
  } catch (error) {
    console.error('Chatbot error:', error);
    res.status(500).json({ 
      error: 'Failed to get response from Ollama cloud service.' 
    });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/student/login');
  });
});

app.listen(3000, () => console.log('Listening on port 3000'));
