import React from "react";

interface ToolbarProps {
  onBold: () => void;
  onItalic: () => void;
}

const Toolbar: React.FC<ToolbarProps> = ({ onBold, onItalic }) => {
  return (
    <div>
      <button onClick={onBold}>Bold</button>
      <>&nbsp;</>
      <button onClick={onItalic}>Italic</button>
    </div>
  );
};

export default Toolbar;
