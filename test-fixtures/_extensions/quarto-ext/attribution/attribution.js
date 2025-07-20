/*****************************************************************
** Author: Roland Schmehl, r.schmehl@tudelft.nl
**
** A plugin for displaying attribution texts sideways along the right
** edge of the viewport. When resizing the viewport or toggling full
** screen mode, the attribution text sticks persistently to the right
** edge of the viewport.
**
** The dynamic scaling of the attribution text via CSS transform
** is adopted from the fullscreen plugin.
**
** Version: 1.0
**
** License: MIT license (see file LICENSE)
**
******************************************************************/

window.RevealAttribution = window.RevealAttribution || {
  id: 'RevealAttribution',
  init: function(deck) {
      initAttribution(deck);
  }
};

const initAttribution = function(Reveal){

var ready = false;
var resize = false;
var scale = 1;

window.addEventListener( 'ready', function( event ) {

  var content;

  // Remove configured margin of the presentation
  var attribution = document.getElementsByClassName("attribution");
  var width = window.innerWidth;
  var configuredWidth = Reveal.getConfig().width;
  var configuredHeight = Reveal.getConfig().height;

  scale = 1/(1-Reveal.getConfig().margin);

  for (var i = 0; i < attribution.length; i++) {
    content = attribution[i].innerHTML;
    attribution[i].style.width = configuredWidth + "px";
    attribution[i].style.height = configuredHeight + "px";
    attribution[i].innerHTML = "<span class='content'>" + content + "</span>";
    attribution[i].style.transform = 'translate( -50%, -50% ) scale( ' + scale*100 + '% ) rotate(-180deg)';
  }

  // Scale with cover class to mimic backgroundSize cover
  resizeCover();

});

window.addEventListener( 'resize', resizeCover );

function resizeCover() {

  // Scale to mimic backgroundSize cover
  var attribution = document.getElementsByClassName("attribution");
  var xScale = window.innerWidth / Reveal.getConfig().width;
  var yScale = window.innerHeight / Reveal.getConfig().height;
  var s = 1;

  if (xScale > yScale) {
      // The div fits perfectly in x axis, stretched in y
      s = xScale/yScale;
  }
  for (var i = 0; i < attribution.length; i++) {
    attribution[i].style.transform = 'translate( -50%, -50% ) scale( ' + s*scale*100 + '% ) rotate(-180deg)';
  }
}

};
