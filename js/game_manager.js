function GameManager(size, InputManager, Actuator, StorageManager) {
  this.size           = size; // Size of the grid
  this.inputManager   = new InputManager;
  this.storageManager = new StorageManager;
  this.actuator       = new Actuator;

  this.startTiles     = 2;

  this.inputManager.on("move", this.move.bind(this));
  this.inputManager.on("restart", this.restart.bind(this));
  this.inputManager.on("keepPlaying", this.keepPlaying.bind(this));
  this.inputManager.on("ai", this.ai.bind(this));

  this.setup();
}

// Restart the game
GameManager.prototype.restart = function () {
  this.storageManager.clearGameState();
  this.actuator.continueGame(); // Clear the game won/lost message
  this.setup();
};

// Keep playing after winning (allows going over 2048)
GameManager.prototype.keepPlaying = function () {
  this.keepPlaying = true;
  this.actuator.continueGame(); // Clear the game won/lost message
};

// Return true if the game is lost, or has won and the user hasn't kept playing
GameManager.prototype.isGameTerminated = function () {
  return this.over || (this.won && !this.keepPlaying);
};

// Set up the game
GameManager.prototype.setup = function () {
  var previousState = this.storageManager.getGameState();

  // Reload the game from a previous game if present
  if (previousState) {
    this.grid        = new Grid(previousState.grid.size,
                                previousState.grid.cells); // Reload grid
    this.score       = previousState.score;
    this.over        = previousState.over;
    this.won         = previousState.won;
    this.keepPlaying = previousState.keepPlaying;
    this.movecountAI = previousState.movecountAI;
    this.movecountHuman = previousState.movecountHuman;
  } else {
    this.grid        = new Grid(this.size);
    this.score       = 0;
    this.over        = false;
    this.won         = false;
    this.keepPlaying = false;
    this.movecountAI = 0;
    this.movecountHuman =0;

    // Add the initial tiles
    this.addStartTiles();
  }

  // Update the actuator
  this.actuate();
  this.actuator.debugClear();
};

// Set up the initial tiles to start the game with
GameManager.prototype.addStartTiles = function () {
  for (var i = 0; i < this.startTiles; i++) {
    this.addRandomTile();
  }
};

// Adds a tile in a random position
GameManager.prototype.addRandomTile = function () {
  if (this.grid.cellsAvailable()) {
    var value = Math.random() < 0.9 ? 2 : 4;
    var tile = new Tile(this.grid.randomAvailableCell(), value);

    this.grid.insertTile(tile);
  }
};

// Sends the updated grid to the actuator
GameManager.prototype.actuate = function () {
  if (this.storageManager.getBestScore() < this.score) {
    this.storageManager.setBestScore(this.score);
  }

  // Clear the state when the game is over (game over only, not win)
  if (this.over) {
    this.storageManager.clearGameState();
  } else {
    this.storageManager.setGameState(this.serialize());
  }

  this.actuator.actuate(this.grid, {
    score:      this.score,
    over:       this.over,
    won:        this.won,
    bestScore:  this.storageManager.getBestScore(),
    terminated: this.isGameTerminated(),
    movecountAI: this.movecountAI,
    movecountHuman: this.movecountHuman
  });
};

// Represent the current game as an object
GameManager.prototype.serialize = function () {
  return {
    grid:        this.grid.serialize(),
    score:       this.score,
    over:        this.over,
    won:         this.won,
    keepPlaying: this.keepPlaying,
    movecountAI: this.movecountAI,
    movecountHuman: this.movecountHuman
  };
};

// Save all tile positions and remove merger info
GameManager.prototype.prepareTiles = function () {
  this.grid.eachCell(function (x, y, tile) {
    if (tile) {
      tile.mergedFrom = null;
      tile.savePosition();
    }
  });
};

// Move a tile and its representation
GameManager.prototype.moveTile = function (tile, cell) {
  this.grid.cells[tile.x][tile.y] = null;
  this.grid.cells[cell.x][cell.y] = tile;
  tile.updatePosition(cell);
};

// Move tiles on the grid in the specified direction
GameManager.prototype.move = function (direction, isAI = false) {
  // 0: up, 1: right, 2: down, 3: left
  var self = this;

  if (this.isGameTerminated()) return; // Don't do anything if the game's over

  var cell, tile;

  var vector     = this.getVector(direction);
  var traversals = this.buildTraversals(vector);
  var moved      = false;

  // Save the current tile positions and remove merger information
  this.prepareTiles();

  // Traverse the grid in the right direction and move tiles
  traversals.x.forEach(function (x) {
    traversals.y.forEach(function (y) {
      cell = { x: x, y: y };
      tile = self.grid.cellContent(cell);

      if (tile) {
        var positions = self.findFarthestPosition(cell, vector);
        var next      = self.grid.cellContent(positions.next);

        // Only one merger per row traversal?
        if (next && next.value === tile.value && !next.mergedFrom) {
          var merged = new Tile(positions.next, tile.value * 2);
          merged.mergedFrom = [tile, next];

          self.grid.insertTile(merged);
          self.grid.removeTile(tile);

          // Converge the two tiles' positions
          tile.updatePosition(positions.next);

          // Update the score
          self.score += merged.value;

          // The mighty 2048 tile
          if (merged.value === 2048) self.won = true;
        } else {
          self.moveTile(tile, positions.farthest);
        }

        if (!self.positionsEqual(cell, tile)) {
          moved = true; // The tile moved from its original cell!
        }
      }
    });
  });

  if (moved) {
    this.addRandomTile();

    if (!this.movesAvailable()) {
      this.over = true; // Game over!
    }

    if (isAI)
      this.movecountAI++;
    else {
      this.actuator.debugClear();
      this.movecountHuman++;
    }
    this.actuate();
  }

  return moved;
};

// Get the vector representing the chosen direction
GameManager.prototype.getVector = function (direction) {
  // Vectors representing tile movement
  var map = {
    0: { x: 0,  y: -1 }, // Up
    1: { x: 1,  y: 0 },  // Right
    2: { x: 0,  y: 1 },  // Down
    3: { x: -1, y: 0 }   // Left
  };

  return map[direction];
};

// Build a list of positions to traverse in the right order
GameManager.prototype.buildTraversals = function (vector) {
  var traversals = { x: [], y: [] };

  for (var pos = 0; pos < this.size; pos++) {
    traversals.x.push(pos);
    traversals.y.push(pos);
  }

  // Always traverse from the farthest cell in the chosen direction
  if (vector.x === 1) traversals.x = traversals.x.reverse();
  if (vector.y === 1) traversals.y = traversals.y.reverse();

  return traversals;
};

GameManager.prototype.findFarthestPosition = function (cell, vector) {
  var previous;

  // Progress towards the vector direction until an obstacle is found
  do {
    previous = cell;
    cell     = { x: previous.x + vector.x, y: previous.y + vector.y };
  } while (this.grid.withinBounds(cell) &&
           this.grid.cellAvailable(cell));

  return {
    farthest: previous,
    next: cell // Used to check if a merge is required
  };
};

GameManager.prototype.movesAvailable = function () {
  return this.grid.cellsAvailable() || this.tileMatchesAvailable();
};

// Check for available matches between tiles (more expensive check)
GameManager.prototype.tileMatchesAvailable = function () {
  var self = this;

  var tile;

  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      tile = this.grid.cellContent({ x: x, y: y });

      if (tile) {
        for (var direction = 0; direction < 4; direction++) {
          var vector = self.getVector(direction);
          var cell   = { x: x + vector.x, y: y + vector.y };

          var other  = self.grid.cellContent(cell);

          if (other && other.value === tile.value) {
            return true; // These two tiles can be merged
          }
        }
      }
    }
  }

  return false;
};

GameManager.prototype.positionsEqual = function (first, second) {
  return first.x === second.x && first.y === second.y;
};


////////////////////////////////////////////////////////////////////////////////
// Run the AI!
GameManager.prototype.ai = function () {
  this.actuator.debugClear();


  var board = this.loadBoard();


//  this.lameAlgorithm1(board);
//  this.lameAlgorithm2(board);
  this.scoreAlgorithm1(board);

};


////////////////////////////////////////////////////////////////////////////////
// Load the board values into a 2D array
GameManager.prototype.loadBoard = function() {
  var board = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];

  this.grid.eachCell(function (x, y, tile) {
    if (tile) {
      board[y][x] = tile.value;
    }
  });

  return board;
};


////////////////////////////////////////////////////////////////////////////////
// Load the largest value on the board and its location
GameManager.prototype.findLargestValue = function (board) {
  var x, y, val = -1;  

  for (var i = 0; i < 4; ++i) {
    for (var j = 0; j < 4; ++j) {    
      if (board[i][j] > val) { 
        x = i;
        y = j;
        val = board[i][j];
      }
    }
  }

  return {x:x, y:y, val:val};
};

////////////////////////////////////////////////////////////////////////////////
// A simple "move upper left" or "move upper right" algorithm
GameManager.prototype.lameAlgorithm1 = async function(board) {
  var cell = this.findLargestValue(board);

  // Find the best match
  var x;
  var y;
  var moved = false;
  var moves = 0;

  
  do {

    x = cell.x
    y = cell.y

    moved = false;
    // move right if the top row is full
    if (board[0][0] != 0 && board[0][1] != 0 && board[0][2] != 0 && board[0][3] != 0)
      moved = this.move(1, true);  //right
    else
      moved = this.move(3, true);  //left
    if (!moved) {
      moved = this.move(0, true);  //up
    }
    var board = this.loadBoard();
    var cell = this.findLargestValue(board);
    if (moved) {
      moves++;
      await this.sleep(250);
    }
  } while ((x != cell.x && y != cell.y) || moved);

  return moves;
};


////////////////////////////////////////////////////////////////////////////////
// Josh's: D L U R
GameManager.prototype.lameAlgorithm2 = async function(board) {
  var moved = true;
  while (moved) {  
    moved = false;
    moved = moved | this.move(2, true); // down, oh no!
    await this.sleep(50);
    moved = moved | this.move(3, true); // left      
    await this.sleep(50);
    moved = moved | this.move(0, true); // up
    await this.sleep(50);
    moved = moved | this.move(1, true); // right  
    await this.sleep(50);
    if (!moved)
      break;
  }
};


////////////////////////////////////////////////////////////////////////////////
// Move to the most advantageous postion based on a score
GameManager.prototype.scoreAlgorithm1 = async function(board) {
  var moves = 0;
  var tmpBoard;
  var baseScore;
  var upScore;
  var rightScore;
  var leftScore;  
  var direction = "none";
  var moved = true;

  while (moved){
    moved = false;
    board = this.loadBoard();
    baseScore = this.scoreBoard(board);
    direction = "none";

//this.actuator.debug(board);
//this.actuator.debug(baseScore);
    tmpBoard = this.testMove(board, 0);  // Up
    upScore = this.scoreBoard(tmpBoard);
//this.actuator.debug(tmpBoard + " up");
//this.actuator.debug(upScore);
    
    tmpBoard = this.testMove(board, 1);  // Right
    rightScore = this.scoreBoard(tmpBoard);
//this.actuator.debug(tmpBoard);
//this.actuator.debug(upScore);
//this.actuator.debug("duh");
    tmpBoard = this.testMove(board, 3);  // Left
    leftScore = this.scoreBoard(tmpBoard);
//this.actuator.debug(tmpBoard + " left");
//this.actuator.debug(upScore);



    
    if (leftScore > rightScore) {
      if (leftScore > upScore) {
        direction = "Left";
        moved = this.move(3, true); // left
      }
      else {
        direction = "Up1";
        moved = this.move(0, true); // up
      }
    }
    else {
      if (rightScore > upScore) {
        direction = "Right";
        moved = this.move(1, true); // right
      }
      else {
        direction = "Up";
        moved = this.move(0, true); // up
      }
    }
    // If nothing happened, try moving left, right, up, and then, the worst: down:
    if (!moved)  
      moved = this.move(3, true); // left
    if (!moved)  
      moved = this.move(1, true); // right
    if (!moved)
      moved = this.move(0, true); // up
    if (!moved)  
      moved = this.move(2, true); // down, oh no!
      
//this.actuator.debugClear();
//this.actuator.debug("Base: " + baseScore);
//this.actuator.debug("Up: " + upScore);
//this.actuator.debug("Right: " + rightScore);
//this.actuator.debug("Left: " + leftScore);
//this.actuator.debug("Direction: " + direction);
    await this.sleep(50);
    if (moved) {
      moves++;
      
    }
  }
  
  return moves;
};

////////////////////////////////////////////////////////////////////////////////
// Execute a move in a temporary board
GameManager.prototype.testMove = function(origBoard, direction) {
  var hasNumber;
  var board = JSON.parse(JSON.stringify(origBoard));
  var retrace

  if (direction === 0) { // Up
    for (var col = 0; col < 4; ++col){
      for (var row = 0; row < 3; ++row) {
        // Collapse the space
        retrace = false;
        for (var i = 0; i < (3 - row) && board[row][col] === 0; ++i) {
          for (var rowWalk = row; rowWalk < 3; ++rowWalk) {
            board[rowWalk][col] = board[rowWalk + 1][col];
            if (board[rowWalk][col] != 0)
              retrace = true;
          }
          board[3][col] = 0;
        }
        if (retrace)
          row = -1;
        else
        // Collapse the number
        if (board[row][col] === board[row + 1][col]) {
          board[row][col] *= 2;
          board[row + 1][col] = 0;
        }
      }
    }
  }
  else if (direction == 3) { // Left
    for (var row = 0; row < 4; ++row){
      for (var col = 0; col < 3; ++col) {
        // Collapse the space
        retrace = false;
        for (var i = 0; i < (3 - col) && board[row][col] === 0; ++i) {
          for (var colWalk = col; colWalk < 3; ++colWalk) {
            board[row][colWalk] = board[row][colWalk + 1];
            if (board[row][colWalk] != 0)
              retrace = true;
          }
          board[row][3] = 0;
          
        }
        if (retrace)
          col = -1;
        else
        // Collapse the number
        if (board[row][col] === board[row][col + 1] && board[row][col] != 0) {
          board[row][col] *= 2;
          board[row][col + 1] = 0;
        }
      }
    }
  }
  else if (direction == 1) { // Right
    for (var row = 0; row < 4; ++row){
      for (var col = 3; col > 0; --col) {
        // Collapse the space
        retrace = false;
        for (var i = 0; i < 3 && board[row][col] === 0; ++i) {
          for (var colWalk = col; colWalk > 0; --colWalk) {
            board[row][colWalk] = board[row][colWalk - 1];
            if (board[row][colWalk] != 0)
              retrace = true;
          }
          board[row][0] = 0;
          
        }
        if (retrace)
          col = 3;
        else
        // Collapse the number
        if (board[row][col] === board[row][col - 1] && board[row][col] != 0) {
          board[row][col] *= 2;
          board[row][col - 1] = 0;
        }
      }
    }
  }  
  return board;
};


////////////////////////////////////////////////////////////////////////////////
// Calculate the score of the board
GameManager.prototype.scoreBoard = function(board) {
  var score = 0;
  var posVal = 8;
  var sum = 0.0;
  var cells = 0;

  // Each cell gets the following values:
  // row 0: 8 7 6 5
  // row 1: 1 2 3 4
  // row 2 & 3: 0
  for (var i = 0; i < 4; ++i)
    for (var j = 0; j < 4; ++j) {
      if (board[i][j] != 0) {
        cells++;
        sum += board[i][j];
      }
      if (posVal > 4){
        score += posVal--;
        if (posVal === 4)
          posVal = 1;
      }
      else if (posVal > 0) {  
        score += posVal++;
        if (posVal == 5)
          posVal = 0;
      }
    }
    
  // Values are added and then divided by the number of cells
  // So, higher values are weighted more...

  score += sum / cells;
//this.actuator.debug(sum);  
//this.actuator.debug(cells);
//this.actuator.debug(score);
    
  return score;
};


GameManager.prototype.sleep = function(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
};

