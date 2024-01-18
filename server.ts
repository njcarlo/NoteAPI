import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json());

interface Note {
  id: string;
  title: string;
  content: string;
}

const notes: Note[] = [];

const validateNoteData = (req: Request, res: Response, next: Function) => {
  const { title, content } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }

  next();
};


app.post('/notes', validateNoteData, (req: Request, res: Response) => {
  const { title, content } = req.body;

  const newNote: Note = {
    id: uuidv4(),
    title,
    content,
  };

  notes.push(newNote);

  return res.status(201).json(newNote);
});

app.get('/notes', (req: Request, res: Response) => {
  return res.json(notes);
});

app.get('/notes/:id', (req: Request, res: Response) => {
  const { id } = req.params;

  const foundNote = notes.find((note) => note.id === id);

  if (!foundNote) {
    return res.status(404).json({ error: 'Note not found' });
  }

  return res.json(foundNote);
});

app.put('/notes/:id', validateNoteData, (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, content } = req.body;

  const noteIndex = notes.findIndex((note) => note.id === id);

  if (noteIndex === -1) {
    return res.status(404).json({ error: 'Note not found' });
  }

  const updatedNote: Note = {
    id,
    title,
    content,
  };

  notes[noteIndex] = updatedNote;

  return res.json(updatedNote);
});

app.delete('/notes/:id', (req: Request, res: Response) => {
  const { id } = req.params;

  const noteIndex = notes.findIndex((note) => note.id === id);

  if (noteIndex === -1) {
    return res.status(404).json({ error: 'Note not found' });
  }

  notes.splice(noteIndex, 1);

  return res.sendStatus(204);
});

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});