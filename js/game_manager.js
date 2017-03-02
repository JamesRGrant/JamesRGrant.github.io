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
  this.inputManager.on("aiStop", this.aiStop.bind(this));
  this.inputManager.on("aiStep", this.aiStep.bind(this));
  this.aiIsRunning = false;

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
  this.aiStep = false;
  this.aiIsRunning = false;
  
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

  if (!this.aiIsRunning)
  {
    var board = this.loadBoard();

    console.clear();
    this.aiIsRunning = true;
    this.aiStep = false;
    
  //  this.lameAlgorithm1(board);
  //  this.lameAlgorithm2(board);
  //  this.scoreAlgorithm1(board);
  //  this.scoreAlgorithm2(board);
  //    this.snakeAlgorithm1(board);
    this.snakeAlgorithm2(board);
  }
};


////////////////////////////////////////////////////////////////////////////////
// Stop the AI!
GameManager.prototype.aiStop = function () {
  this.aiIsRunning = false;
  this.aiStep = false;
};


////////////////////////////////////////////////////////////////////////////////
// Step the AI!
GameManager.prototype.aiStep = function () {
  console.clear();
  this.aiStep = true;
  if (!this.aiIsRunning)
  {
    var board = this.loadBoard();
    this.aiIsRunning = true;
    this.snakeAlgorithm2(board);
  }
};



////////////////////////////////////////////////////////////////////////////////
// Load the board values into a 2D array
GameManager.prototype.loadBoard = function() {
  var board = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];

  this.grid.eachCell(function (x, y, tile) {
    if (tile) {
      board[x][y] = tile.value;
    }
  });

  return board;
};


////////////////////////////////////////////////////////////////////////////////
// Load the largest value on the board and its location
GameManager.prototype.findLargestValue = function (board) {
  var x, y, val = -1;  

//console.debug(board);
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
  var x;
  var y;
  var moved = false;
  var moves = 0;
  var cell = this.findLargestValue(board);
  
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
  var tmpBoard;
  var baseScore;
  var upScore;
  var rightScore;
  var leftScore;  
  var moved = true;

  while (moved){
    moved = false;
    board = this.loadBoard();
    baseScore = this.scoreBoard(board);

    // Test each direction and score it
    tmpBoard = this.testMove(board, 0);  // Up
    upScore = this.scoreBoard(tmpBoard);
    tmpBoard = this.testMove(board, 1);  // Right
    rightScore = this.scoreBoard(tmpBoard);
    tmpBoard = this.testMove(board, 3);  // Left
    leftScore = this.scoreBoard(tmpBoard);
    
    // Move to the best locaion
    if (leftScore > rightScore) 
      if (leftScore > upScore) 
        moved = this.move(3, true); // left
      else 
        moved = this.move(0, true); // up
    else 
      if (rightScore > upScore) 
        moved = this.move(1, true); // right
      else 
        moved = this.move(0, true); // up

    // If nothing happened, do a random move
    if (!moved)
      moved = this.moveRandom();
      
    await this.sleep(50);
  }
};


////////////////////////////////////////////////////////////////////////////////
// Move to the most advantageous postion based on a score, looking 2 moves ahead
GameManager.prototype.scoreAlgorithm2 = async function(board) {
  var tmpBoard;
  var childBoard;
  var baseScore;
  var u, r, l;
  var cu, cr, cl;
  var moved = true;

  while (moved){
    moved = false;
    board = this.loadBoard();
    baseScore = this.scoreBoard(board);

    tmpBoard = this.testMove(board, 0);  // Up
    u = this.scoreBoard(tmpBoard);
    childBoard = this.testMove(tmpBoard, 0)
    cu = this.scoreBoard(board);
    childBoard = this.testMove(tmpBoard, 1)
    cr = this.scoreBoard(board);
    childBoard = this.testMove(tmpBoard, 3)
    cl = this.scoreBoard(board);
    u += Math.max(cu, cr, cl);
      
    tmpBoard = this.testMove(board, 1);  // Right
    r = this.scoreBoard(tmpBoard);
    childBoard = this.testMove(tmpBoard, 0)
    cu = this.scoreBoard(board);
    childBoard = this.testMove(tmpBoard, 1)
    cr = this.scoreBoard(board);
    childBoard = this.testMove(tmpBoard, 3)
    cl = this.scoreBoard(board);
    r += Math.max(cu, cr, cl);

    tmpBoard = this.testMove(board, 3);  // Left
    l = this.scoreBoard(tmpBoard);
    childBoard = this.testMove(tmpBoard, 0)
    cu = this.scoreBoard(board);
    childBoard = this.testMove(tmpBoard, 1)
    cr = this.scoreBoard(board);
    childBoard = this.testMove(tmpBoard, 3)
    cl = this.scoreBoard(board);
    l += Math.max(cu, cr, cl);
    
    if (l > r) 
      if (l > u) 
        moved = this.move(3, true); // left
      else 
        moved = this.move(0, true); // up
    else 
      if (r > u) 
        moved = this.move(1, true); // right
      else 
        moved = this.move(0, true); // up

    // If nothing happened, do a random move
    if (!moved)
      moved = this.moveRandom();
      
    await this.sleep(50);
  }
};


////////////////////////////////////////////////////////////////////////////////
// Make a random move, and then move back QUICK if it is a bad direction!
GameManager.prototype.moveRandom = function() {
  var moved = false;

console.debug("--------------------> RANDOM!!!");

  moved = this.move(0, true); // up

  if (!moved)
    moved = this.move(3, true); // left
  
  if (!moved) 
    moved = this.move(1, true); // right

  if (!moved) { 
    moved = this.move(2, true); // down, oh no!
    if (moved)
      moved = this.move(0, true); // up
  }
  
  return moved;
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
    
  return score;
};


////////////////////////////////////////////////////////////////////////////////
// Call with await this.sleep(50);
// Need async before function in declaration:  myFunction = async function(){};
GameManager.prototype.sleep = function(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
};


////////////////////////////////////////////////////////////////////////////////
// Snake in descending order
GameManager.prototype.snakeAlgorithm1 = async function(board) {
  var moved = true;
  var cell;
  var canMove;
  var direction;
  
  while (moved){
    moved = false;
    board = this.loadBoard();
    
    cell = this.findLargestValue(board);
//console.debug("largest x = " + cell.x + ", y = " + cell.y + ", val = " + cell.val);
    if (cell.x != 0 || cell.y != 0)
    {
      // See if we can move left
      if (cell.x != 0)
      {
        canMove = true;
        for (var i = 0; i < cell.x; ++i)
        {
          if (board[i][cell.y] != 0)
            canMove = false;
        }
        if (canMove)
          moved = this.move(3, true); // left
      }
      if (!moved && cell.y !=0)
      {
        // See if we can move up
        canMove = true;
        for (var i = 0; i < cell.y; ++i)
        {
          if (board[cell.x][i] != 0)
            canMove = false;
        }
        if (canMove)
          moved = this.move(0, true); // up
      }
      if (!moved)
      {
        // OK, try and build up this cell
        direction = this.buildUp(board, 0, 0, cell.val);
          if (direction != -1)
            moved = this.move(direction, true); 
      } 
    }
    else
    {
      // Move to the next
      direction = this.buildUp(board, 0, 0, cell.val);
          if (direction != -1)
            moved = this.move(direction, true); 
    }
    
    // If nothing happened, do a random move
//    if (!moved)
//      moved = this.moveRandom();
      
    await this.sleep(0000);
  }
};

////////////////////////////////////////////////////////////////////////////////
// Determine how to increase a specific cell
GameManager.prototype.buildUp = function(board, x, y, val) {
  var direction = -1;
  var canRight = false;
  var canLeft = false;
  var canUp = false;
  var canDown = false;
  var stop = false;

//console.debug("In " + x + ", " + y + ", " + val);

  // Look for an exact match
  // Check to the left
  for (var i = x - 1; i >= 0  && direction == -1; --i)
    if (board[i][y] != 0)
    {
      if (board[i][y] == board[x][y])
        direction = 1; // right
      break;  // Need to break on any non-zero
    }
    else
      canRight = true;
    
  // Check to the right
  for (var i = x + 1; i <= 3  && direction == -1; ++i)
    if (board[i][y] != 0)
    {
      if (board[i][y] == board[x][y])
        direction = 3; // left
      break;  // Need to break on any non-zero
    }
    else
      canLeft = true;
      
  // Check upI
  for (var j = y - 1; j >= 0 && direction == -1; --j)
    if (board[x][j] != 0)
    {
      if (board[x][j] == board[x][y])
        direction = 2; // down
      break;  // Need to break on any non-zero
    }
    else
      canDown = true;

  // Check down
  for (var j = y + 1; j <= 3 && direction == -1; ++j)
    if (board[x][j] != 0)
    {
      if (board[x][j] == board[x][y])
        direction = 0; // up
      break;  // Need to break on any non-zero
    }
    else
      canUp = true;
//console.debug("Exact from: " + direction);

  // Look for something EQUAL you can move inline
  if (direction == -1)
    // Blank cells below, look right
    for (var j = y + 1, stop = false; j <= 3 && direction == -1 && canUp && board[x][j] == 0 && !stop; ++j)
      // Look right
      for (var i = x + 1; i < 4; ++i)
      {
        if (board[i][j] != 0)
        {
          if (board[i][j] == board[x][y]) 
            if (i == 3)
              direction = 3; // left
            else if (board[i + 1][j] != board[x][y]) // avoid accidental combine
              direction = 3;
          else
            stop = true;  // Have to stop because a bigger number will come through
          break;
        }
      }
      
    // Blank cells below, look right
    for (var j = y + 1, stop = false; j <= 3 && direction == -1 && canUp && board[x][j] == 0 && !stop; ++j)     
    {
      // Look left
      for (var i = x - 1; i >= 0; --i)
        if (board[i][j] != 0)
        {
          if (board[i][j] == board[x][y] && i >= 0 && board[i - 1][j] != board[x][y]) // avoid accidental combine
            direction = 1; // right
          else
            stop = true;
          break;
        }
    }
    
  // Look for something smaller in direct path
  if (direction == -1)
    for (var j = y + 1; j <= 3 && direction == -1 && canUp; ++j) 
      if (board[x][j] > 0)
      {
        if (board[x][j] < board[x][y])
          direction = 0;  // up
        break;
      }
    
  // Look for something SMALLER you can move inline
  if (direction == -1)
    // Blank cells below, look right
    for (var j = y + 1, stop = false; j <= 3 && direction == -1 && canUp && board[x][j] == 0 && !stop; ++j)
      // Look right
      for (var i = x + 1; i < 4; ++i)
      {
        if (board[i][j] != 0)
        {
          if (board[i][j] < board[x][y])
            direction = 3; // left
          else
            stop = true;  // Have to stop because a bigger number will come through
          break;
        }
      }
      
    // Blank cells below, look right
    for (var j = y + 1, stop = false; j <= 3 && direction == -1 && canUp && board[x][j] == 0 && !stop; ++j)     
    {
      // Look left
      for (var i = x - 1; i >= 0; --i)
        if (board[i][j] != 0)
        {
          if (board[i][j] < board[x][y])
            direction = 1; // right
          else
            stop = true;
          break;
        }
    }    
/*      
    if (canLeft)
      direction = 3;
    else if (canRight)
      direction = 1;
    else if (canDown)
      direction = 0;
*/
//console.debug("Offset equal from: " + direction);

/*
  // If no exact match, but open spaces, just move one
  if (direction == -1)
    if (canUp)
      direction = 0;
    else if (canLeft)
      direction = 3;
    else if (canRight)
      direction = 1;
    else if (canDown)
      direction = 0;
    else
      direction = this.buildUp(board, x, y + 1, board[x][y]);
      

console.debug("Blank from: " + direction);
*/      
  if (direction == -1 && y != 3)
    direction = this.buildUp(board, x, y + 1, board[x][y]);
      
  return direction;
};

////////////////////////////////////////////////////////////////////////////////
// Snake in descending order
GameManager.prototype.snakeAlgorithm2 = async function(board) {
  var moved = true;
  var ub, rb, db, rb;
  var cell = this.findLargestValue(board);
  var x = cell.x;
  var y = cell.y;
  var done = false;
  var direction = -1;
  var keepLeft, keepUp, keepRight;


//console.debug("Max at " + x + ", " + y); 
 
  while (moved && this.aiIsRunning)
  {
    keepLeft = false;
    keepUp = false;
    keepRight = false;
    moved = false;
    direction = -1;
    done = false;
      x=0;y=0;
    
    // Save each move possible so we can find out what is best
    board = this.loadBoard();
    ub = this.testMove2(board, 0);  // Up
    rb = this.testMove2(board, 1);  // Right
    db = this.testMove2(board, 2);  // Down
    lb = this.testMove2(board, 3);  // Left

    if (board[0][0] != 0)
    {
      keepUp = true;
      keepLeft = true;
    }


//console.debug(board);  
//console.debug("U=" + ub);
//console.debug("R=" + rb);
//console.debug("D=" + db);
//console.debug("L=" + lb);


      // Assuming starting in the upper left and going right
      while (direction == -1)  
      {
        direction = this.processCell(board, x, y);
        if (direction == -2)
        {
          direction = -1;
          direction = this.processCell(board, x, y + 1);          
        
        }
 
        // if nothing is done, move to the next cell
        if (direction == -1)
        {
          if (y == 0 || y == 2)
          {
            x++;
            if (x == 4)
            {
              x--;
              y++;
              if (y == 1 && board[0][0] != 0 && board[1][0] != 0 && board[3][0] != 0 && board[3][0] != 0)
              {
                keepRight = true;
                keepLeft = false;
              }
            }
          }
          else
          {
            if (y == 1 && board[0][0] != 0 && board[1][0] != 0 && board[3][0] != 0 && board[3][0] != 0)
            {
              keepRight = true;
              keepLeft = false;
            }
            --x;
            if (x == -1)
            {
              ++x;
              ++y;
            }
          }
          if (y == 4)
            break;
        }
      }

//console.debug(direction);  

    // If untrapping, ignore the safe direction flags
    if (this.unTrap && direction >= 0)
    {
      this.unTrap = false;
      moved = this.move(direction, true);
    }
    else
    {
      if (direction == 0)
        moved = this.move(direction, true);
        
      if (direction == 1 && !keepLeft)
        moved = this.move(direction, true);
            
      if (direction == 2 && !keepUp)
        moved = this.move(direction, true);

      if (direction == 3 && !keepRight)
        moved = this.move(direction, true);
    }
    
    // If nothing happened, do a random move
    if (!moved)
      moved = this.moveRandom();

    // If we are just doing a step, bail.  Otherwise, delay a bit.
    if (this.aiStep)
    {
      this.aiStep = false
      this.aiIsRunning = false;
    }
    else
      await this.sleep(0);
  }
};


////////////////////////////////////////////////////////////////////////////////
// Process a cell
GameManager.prototype.processCell = function(board, x, y) {
  var direction = -1;
  var ub = this.testMove2(board, 0);  // Up
  var rb = this.testMove2(board, 1);  // Right
  var db = this.testMove2(board, 2);  // Down
  var lb = this.testMove2(board, 3);  // Left

  // See if the this cell grow
  if (y == 0 || y == 2)
  {
    if (lb[x][y] > board[x][y] && !this.keepRight)
      direction = 3; // left
    else if (ub[x][y] > board[x][y])
      direction = 0; // up
  }
  else
  {
    if (ub[x][y] > board[x][y])
      direction = 0; // up
    else if (rb[x][y] > board[x][y] && !this.keepLeft)
      direction = 1; // right
  }
  
if (direction != -1)
  console.debug("ProcessCell: " + x + ", " + y + ": " + direction); 
  
  // if nothing is done, check and resolve trapped cell before moving on
  if (direction == -1)
  {
    if (this.isTrapped(board, x, y))
    {
      direction = this.freeTrapped(board, x, y);  
      if (direction == -1)
        direction = -2;
      console.debug("ProcessCell: " + x + ", " + y + ": " + direction + " (trapped)");
    }
    else
      console.debug("ProcessCell: " + x + ", " + y + ": " + direction);
  }
  return direction;
};


////////////////////////////////////////////////////////////////////////////////
// Test a move in a direction
GameManager.prototype.testMove2 = function(origBoard, direction) {
  var board = JSON.parse(JSON.stringify(origBoard));  // make a full copy
  var retrace;

  if (direction === 0) { // Up
    for (var x = 0; x < 4; ++x){
      for (var y = 0; y < 3; ++y) {
        // Collapse the space
        retrace = false;
        for (var i = 0; i < (3 - y) && board[x][y] === 0; ++i) {
          for (var yWalk = y; yWalk < 3; ++yWalk) {
            board[x][yWalk] = board[x][yWalk + 1];
            if (board[x][yWalk] != 0)
              retrace = true;
          }
          board[x][3] = 0;
        }
        if (retrace)
          y = -1;
        else
        // Collapse the number
        if (board[x][y] === board[x][y + 1]) {
          board[x][y] *= 2;
          board[x][y + 1] = 0;
        }
      }
    }
  }
  if (direction === 3) { // Left
    for (var y = 0; y < 4; ++y){
      for (var x = 0; x < 3; ++x) {
        // Collapse the space
        retrace = false;
        for (var i = 0; i < (3 - x) && board[x][y] === 0; ++i) {
          for (var xWalk = x; xWalk < 3; ++xWalk) {
            board[xWalk][y] = board[xWalk + 1][y];
            if (board[xWalk][y] != 0)
              retrace = true;
          }
          board[3][y] = 0;
        }
        if (retrace)
          x = -1;
        else
        // Collapse the number
        if (board[x][y] === board[x + 1][y]) {
          board[x][y] *= 2;
          board[x + 1][y] = 0;
        }
      }
    }
  }
  if (direction === 2) { // Down
    for (var x = 0; x < 4; ++x){
      for (var y = 3; y > 0; --y) {
        // Collapse the space
        retrace = false;
        for (var i = 0; i < y && board[x][y] === 0; ++i) {
          for (var yWalk = y; yWalk > 0; --yWalk) {
            board[x][yWalk] = board[x][yWalk - 1];
            if (board[x][yWalk] != 0)
              retrace = true;
          }
          board[x][0] = 0;
        }
        if (retrace)
          y = 3;
        else
        // Collapse the number
        if (board[x][y] === board[x][y - 1]) {
          board[x][y] *= 2;
          board[x][y - 1] = 0;
        }
      }
    }
  }
// TODO: 2020 goes to 0022  
  if (direction === 1) { // Right
    for (var y = 0; y < 4; ++y){
      for (var x = 3; x > 0; --x) {
        // Collapse the space
        retrace = false;
        for (var i = 0; i < x && board[x][y] === 0; ++i) {
          for (var xWalk = x; xWalk > 0; --xWalk) {
            board[xWalk][y] = board[xWalk - 1][y];
            if (board[xWalk][y] != 0 || board[xWalk - 1][y] != 0)
              retrace = true;
          }
          board[0][y] = 0;
        }
        if (retrace)
          x = 3;
        else
        // Collapse the number
        if (board[x][y] === board[x - 1][y]) {
          board[x][y] *= 2;
          board[x - 1][y] = 0;
        }
      }
    }
  } 
  return board;
};

////////////////////////////////////////////////////////////////////////////////
// See if a cell is trapped by a higher value
GameManager.prototype.isTrapped = function(board, x, y) {
  var x2, y2;
  var trapped = false;

  if (y == 0 || y == 2)  // check right and down
  {
    x2 = x + 1;
    y2 = y + 1;
    if (x2 < 4)
    {
      if (board[x2][y] > board[x][y])// && board[x][y2] > board[x][y])
        trapped = true;
      // TODO: trigger a "build up" if the next cell is bigger and the lower is OK
    }
    else if (board[x][y2] > board[x][y])
      trapped = true;
  }
  else if (y == 1 || y == 3)
  {
    x2 = x - 1;
    if (y == 1)
      y2 = y + 1;
    if (x2 >= 0)
    {
      if (board[x2][y] > board[x][y])// && board[x][y2] > board[x][y])
        trapped = true;
    }
    else if (board[x][y2] > board[x][y])
      trapped = true;
  }      
  return trapped;
}


////////////////////////////////////////////////////////////////////////////////
// Try and untrap this cell!
GameManager.prototype.freeTrapped = function(board, x, y) {
  var x2, y2;
  var direction = -1;
  var tmpBoard;

  // Try and free under it
  if (y == 0 || y == 2)
  {
    tmpBoard = this.testMove2(board, 3); // Left
console.debug(tmpBoard);
    if (tmpBoard[x][y + 1] < board[x][y ] && board != tmpBoard)
      direction = 3;
    else   
    {
      tmpBoard = this.testMove2(board, 1); // Right
      if (tmpBoard[x][y + 1] < board[x][y ] && board != tmpBoard)
        direction = 1;
    }
  }
  if (y == 1)
  {
    tmpBoard = this.testMove2(board, 1); // Right
    if (tmpBoard[x][y + 1] < board[x][y ] && board != tmpBoard)
      direction = 1;
    else   
    {
      tmpBoard = this.testMove2(board, 3); // Left
      if (tmpBoard[x][y + 1] < board[x][y ] && board != tmpBoard)
        direction = 3;
    }
  }
  
  this.unTrap = true;

  return direction;
}





