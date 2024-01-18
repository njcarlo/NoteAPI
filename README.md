# Notes API

This is a simple RESTful API for managing notes. It allows you to create, retrieve, update, and delete notes.

## Getting Started

### Prerequisites

- Node.js (https://nodejs.org)
- npm (Node Package Manager)

### Installation

1. Clone the repository: git clone [https://github.com/njcarlo/NoteAPI.git](https://github.com/njcarlo/NoteAPI.git)
2. Navigate to the project directory: cd notes-api
3. Install the required dependencies: npm install

### Usage

1. Start the API server: npm start
   The API server will start running on `http://localhost:3000`.

2. Send HTTP requests to the API using a tool like Postman or curl. Here are some example requests:

- Create a new note: http POST http://localhost:3000/notes

        Content-Type: application/json
        
        {
        
              "title": "My First Note",
           
              "content": "This is the content of my first note."
        
        }
  
- Retrieve all notes: http GET http://localhost:3000/notes

- Retrieve a specific note by ID: http GET http://localhost:3000/notes/:id

- Update a specific note by ID: http PUT http://localhost:3000/notes/:id

        Content-Type: application/json
        
         {
        
              "title": "Updated Note",
           
              "content": "This is the updated content of the note."
        
         }

- Delete a specific note by ID: http DELETE http://localhost:3000/notes/:id

3. Explore the API endpoints and their responses.

## Contributing

Contributions are welcome! If you find any issues or have suggestions for improvements, please open an issue or submit a pull request.

## License

This project is licensed under the [MIT License](LICENSE).
