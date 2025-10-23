import mongoose from 'mongoose';

const courseSchema = new mongoose.Schema({
  title: String,
  image: String,
  link: String
});

export default mongoose.model('Course', courseSchema);
